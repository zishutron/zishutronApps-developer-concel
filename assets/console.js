        // ============================================
        // FIREBASE CONFIG
        // ============================================
        const firebaseConfig = {
            apiKey: "AIzaSyDCOq720_5pxOsUYXovvi4DaUsryv1oPeA",
            authDomain: "stardust-store.firebaseapp.com",
            databaseURL: "https://stardust-store-default-rtdb.firebaseio.com",
            projectId: "stardust-store",
            storageBucket: "stardust-store.firebasestorage.app",
            messagingSenderId: "979834482722",
            appId: "1:979834482722:web:dabbc453543b7e03c91a7b",
            measurementId: "G-YKYR514S87"
        };

        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.database();

        // ============================================
        // IMGBB API KEY
        // ============================================
        const IMGBB_KEY = "550a3bcd47c1b0a86a9f2ba7a41770b6";

        // ============================================
        // STATE
        // ============================================
        let currentUser = null;
        let allApps = [];
        let allReviews = {};
        let allNotifications = [];
        let currentReviewFilter = 'all';
        let currentPage = document.body.dataset.page || 'dashboard';
        let isLoginMode = true;
        let currentStep = 1;
        let editAppId = null;
        let updateAppId = null;
        let drafts = JSON.parse(localStorage.getItem('stardust_drafts') || '{}');
        let activityLog = JSON.parse(localStorage.getItem('stardust_activity_log') || '[]');

        // ============================================
        // DOM REFS
        // ============================================
        // Safe element lookup: every page only contains its own section, so a missing element returns a harmless stand-in
        const NULL_EL = new Proxy(function () {}, {
            get: (t, k) => k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains() { return false; } }
                : (k === 'style' || k === 'dataset') ? {} : k === 'files' ? [] : (k === 'value' || k === 'textContent' || k === 'innerHTML') ? ''
                : k === Symbol.toPrimitive ? () => '' : () => NULL_EL,
            set: () => true, apply: () => NULL_EL
        });
        const $ = id => document.getElementById(id) || NULL_EL;
        const loginPage = $('loginPage');
        const appContainer = $('appContainer');
        const loadingOverlay = $('loadingOverlay');
        const loadingText = $('loadingText');

        // ============================================
        // LOADING
        // ============================================
        const SPLASH_MIN_MS = 900; // let the UptoZishu light sweep be seen on every page change
        function showLoading(show, text = '') {
            if (show) {
                loadingText.textContent = /^(Loading|Starting)/.test(text) ? '' : text;
                loadingOverlay.classList.add('show');
            } else {
                const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
                setTimeout(() => loadingOverlay.classList.remove('show'), wait);
            }
        }

        // ============================================
        // AUTH
        // ============================================
        const USER_RE = /^[a-z0-9_.]{3,20}$/;
        let pendingSignup = false; // true while sign-up is still saving the profile, so the auth listener doesn't redirect early
        const cleanUser = u => String(u || '').trim().toLowerCase().replace(/^@+/, '');
        const userError = u => USER_RE.test(u) ? '' : 'Username must be 3–20 characters: lowercase letters, numbers, _ or .';
        function authMsg(err) {
            const c = err && err.code;
            if (c === 'auth/email-already-in-use') return 'This email already has an account. Tap "Sign in" instead. If you use the UptoZishu store with it, your store username is used here too.';
            if (c === 'auth/invalid-email') return 'Enter a valid email address.';
            if (c === 'auth/weak-password') return 'Password must be at least 6 characters.';
            if (c === 'auth/user-not-found' || c === 'auth/wrong-password' || c === 'auth/invalid-credential' || c === 'auth/invalid-login-credentials') return 'Wrong email or password.';
            if (c === 'auth/too-many-requests') return 'Too many tries. Please wait a bit and try again.';
            if (c === 'auth/network-request-failed') return 'No internet connection.';
            if (err && err.message === 'taken') return 'That username is already taken.';
            return (err && err.message) || 'Something went wrong. Please try again.';
        }
        // live "available / taken" hint under a username box
        function watchUsername(inputId, hintId, idleText) {
            const input = $(inputId), hint = $(hintId); let t = 0;
            if (!input || !hint) return;
            const set = (txt, cls) => { hint.textContent = txt; hint.className = 'hint' + (cls ? ' ' + cls : ''); };
            input.addEventListener('input', () => {
                clearTimeout(t);
                const u = cleanUser(input.value);
                if (!u) { set(idleText || '', ''); return; }
                const bad = userError(u); if (bad) { set(bad, 'bad'); return; }
                set('Checking…', '');
                t = setTimeout(() => {
                    db.ref('usernames/' + u).once('value').then(snap => {
                        if (cleanUser(input.value) !== u) return;
                        const owner = snap.val();
                        if (owner && (!auth.currentUser || owner !== auth.currentUser.uid)) set('@' + u + ' is already taken', 'bad'); else set('@' + u + ' is available', 'ok');
                    }).catch(() => set(idleText || '', ''));
                }, 400);
            });
        }
        watchUsername('signUser', 'signUserHint', '');
        watchUsername('compUser', 'compUserHint', '3–20 characters: lowercase letters, numbers, _ or .');

        function switchAuthMode() {
            isLoginMode = !isLoginMode;
            const btn = $('loginBtn');
            document.querySelectorAll('#loginForm .su').forEach(el => { el.hidden = isLoginMode; });
            $('googleLabel').textContent = isLoginMode ? 'Sign in with Google' : 'Sign up with Google';
            if (isLoginMode) {
                btn.textContent = 'Sign In';
                document.querySelector('.toggle-mode').innerHTML =
                    `Don't have an account? <span onclick="switchAuthMode()">Create one</span>`;
            } else {
                btn.textContent = 'Create Account';
                document.querySelector('.toggle-mode').innerHTML =
                    `Already have an account? <span onclick="switchAuthMode()">Sign in</span>`;
            }
            $('loginError').textContent = '';
        }

        // claim the username for this uid, then write the shared profile (same records the UptoZishu store uses)
        function saveDevProfile(user, name, uname, bio) {
            const uref = db.ref('usernames/' + uname);
            return uref.once('value').then(snap => {
                const owner = snap.val();
                if (owner && owner !== user.uid) throw new Error('taken');
                if (owner === user.uid) return;
                return uref.set(user.uid).catch(() => { throw new Error('taken'); });
            }).then(() => db.ref('users/' + user.uid).once('value')).then(snap => {
                const old = snap.val() || {};
                return db.ref('users/' + user.uid).set({ name, username: uname, bio, createdAt: old.createdAt || Date.now() });
            }).then(() => {
                db.ref('developers/' + user.uid).update({ displayName: name, bio, username: uname, email: user.email || '' }).catch(() => {});
                try { user.updateProfile({ displayName: name }); } catch (e) {}
            });
        }

        function showComplete(user, pre) {
            pre = pre || {};
            loginPage.style.display = 'none';
            $('completePage').style.display = 'flex';
            $('compName').value = pre.name || user.displayName || '';
            $('compBio').value = pre.bio || '';
            showLoading(false);
        }
        function signOutFromComplete() {
            auth.signOut().then(() => { try { localStorage.removeItem('stardust_uid'); } catch (e) {} location.replace('/auth/'); });
        }
        function handleComplete(e) {
            e.preventDefault();
            const user = auth.currentUser, err = $('compError'), btn = $('compBtn');
            if (!user) { err.textContent = 'Please sign in again.'; return; }
            const name = $('compName').value.trim(), uname = cleanUser($('compUser').value), bio = $('compBio').value.trim().slice(0, 140);
            if (name.length < 2) { err.textContent = 'Please enter your name.'; return; }
            const bad = userError(uname); if (bad) { err.textContent = bad; return; }
            btn.disabled = true; btn.textContent = 'Saving...'; err.textContent = '';
            saveDevProfile(user, name, uname, bio).then(() => goNext()).catch(x => {
                btn.disabled = false; btn.textContent = 'Continue'; err.textContent = authMsg(x);
            });
        }

        function handleAuth(e) {
            e.preventDefault();
            const email = $('loginEmail').value.trim();
            const password = $('loginPassword').value;
            const btn = $('loginBtn');
            const errorEl = $('loginError');

            if (!email || !password) { errorEl.textContent = 'Please fill all fields.'; return; }
            if (password.length < 6) { errorEl.textContent = 'Password must be at least 6 characters.'; return; }

            if (isLoginMode) {
                btn.disabled = true; btn.textContent = 'Signing in...'; errorEl.textContent = '';
                auth.signInWithEmailAndPassword(email, password)
                    .then(() => { btn.disabled = false; btn.textContent = 'Sign In'; })
                    .catch(err => { btn.disabled = false; btn.textContent = 'Sign In'; errorEl.textContent = authMsg(err); });
                return;
            }

            // sign up: Name, Username, Bio, Email, Password, Confirm password
            const name = $('signName').value.trim(), uname = cleanUser($('signUser').value), bio = $('signBio').value.trim().slice(0, 140);
            if (name.length < 2) { errorEl.textContent = 'Please enter your name.'; return; }
            const bad = userError(uname); if (bad) { errorEl.textContent = bad; return; }
            if (password !== $('signConfirm').value) { errorEl.textContent = 'Passwords do not match.'; return; }
            btn.disabled = true; btn.textContent = 'Creating account...'; errorEl.textContent = '';
            const reset = () => { btn.disabled = false; btn.textContent = 'Create Account'; };
            db.ref('usernames/' + uname).once('value').catch(() => null).then(snap => {
                if (snap && snap.val()) throw new Error('taken');
                pendingSignup = true;
                return auth.createUserWithEmailAndPassword(email, password);
            }).then(result => saveDevProfile(result.user, name, uname, bio).then(() => { pendingSignup = false; goNext(); }, x => {
                // account exists but the profile could not be saved (e.g. username just got taken): let them fix it
                pendingSignup = false; reset(); showComplete(result.user, { name, bio });
                $('compUser').value = uname; $('compError').textContent = authMsg(x);
            })).catch(err => { pendingSignup = false; reset(); errorEl.textContent = authMsg(err); });
        }

        // Google Sign-In (works for sign in and sign up; new accounts get the "Finish your profile" step)
        function signInWithGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider)
                .catch(err => {
                    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
                    alert('Google Sign-In failed: ' + err.message);
                });
        }

        // after any sign-in on the auth page: existing profile (e.g. from the store) -> go in, otherwise finish the profile
        function ensureProfile(user) {
            db.ref('users/' + user.uid).once('value').then(snap => {
                const p = snap.val();
                if (p && p.username) {
                    db.ref('developers/' + user.uid).update({ username: p.username, email: user.email || '' }).catch(() => {});
                    db.ref('developers/' + user.uid + '/displayName').once('value').then(d => { if (!d.val() && p.name) db.ref('developers/' + user.uid + '/displayName').set(p.name); }).catch(() => {});
                    goNext();
                } else showComplete(user, p || {});
            }).catch(() => goNext());
        }

        // ============================================
        // INIT APP
        // ============================================
        function initApp(user) {
            currentUser = user;
            loginPage.style.display = 'none';
            appContainer.classList.add('show');

            const name = user.displayName || user.email.split('@')[0] || 'Developer';
            $('userDisplayName').textContent = name;
            $('userDisplayEmail').textContent = user.email;
            $('userAvatar').textContent = name.charAt(0).toUpperCase();
            $('welcomeMsg').textContent = `Welcome Back, ${name}`;

            // Load data
            loadApps();
            loadNotifications();
            initPage();
            localStorage.setItem('stardust_uid', user.uid);
            // accounts without a username (older developers) finish their profile first
            db.ref('users/' + user.uid).once('value').then(snap => {
                const p = snap.val();
                if (p && p.username) window._devUsername = p.username;
                else if (!leaving) { leaving = true; location.replace('/auth/?next=' + encodeURIComponent(location.pathname + location.search)); }
            }).catch(() => {});
            showLoading(false);
        }

        // ============================================
        // AUTH STATE LISTENER
        // ============================================
        const ON_AUTH_PAGE = currentPage === 'auth';
        function nextUrl() {
            const n = new URLSearchParams(location.search).get('next') || '/';
            return (n.charAt(0) === '/' && n.charAt(1) !== '/' && n.indexOf('/auth') !== 0) ? n : '/';
        }
        let leaving = false;
        function goNext() { if (leaving) return; leaving = true; location.replace(nextUrl()); }

        auth.onAuthStateChanged(user => {
            if (user) {
                try { localStorage.setItem('stardust_uid', user.uid); } catch (e) {}
                if (ON_AUTH_PAGE) { if (!pendingSignup && !leaving) ensureProfile(user); return; }
                if (!appContainer.classList.contains('show')) initApp(user);
            } else {
                try { localStorage.removeItem('stardust_uid'); } catch (e) {}
                if (ON_AUTH_PAGE) {
                    loginPage.style.display = 'flex';
                    showLoading(false);
                } else if (!leaving) {
                    leaving = true;
                    location.replace('/auth/?next=' + encodeURIComponent(location.pathname + location.search));
                }
            }
        });

        // ============================================
        // THEME - Persistent
        // ============================================
        const THEME_KEY = 'zt_console_theme'; // 'dark' | 'light'; nothing saved = follow the phone's system theme
        let darkMode = true;
        const sysDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: true };

        function applyTheme(dark, persist) {
            const root = document.documentElement;
            const v = dark
                ? { '--bg-dark': '#0b0f19', '--bg-card': '#111827', '--bg-input': '#1f2937', '--text-light': '#f9fafb', '--text-gray': '#9ca3af', '--border-color': '#374151' }
                : { '--bg-dark': '#f1f5f9', '--bg-card': '#ffffff', '--bg-input': '#e2e8f0', '--text-light': '#0f172a', '--text-gray': '#475569', '--border-color': '#cbd5e1' };
            Object.keys(v).forEach(k => root.style.setProperty(k, v[k]));
            root.style.colorScheme = dark ? 'dark' : 'light';
            try { if (persist) localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) {}
            darkMode = dark;
        }
        let savedTheme = null;
        try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
        applyTheme(savedTheme ? savedTheme === 'dark' : sysDark.matches, false);
        if (sysDark.addEventListener) sysDark.addEventListener('change', e => {
            let s = null; try { s = localStorage.getItem(THEME_KEY); } catch (x) {}
            if (!s) applyTheme(e.matches, false);
        });
        function useSystemTheme() {
            try { localStorage.removeItem(THEME_KEY); } catch (e) {}
            applyTheme(sysDark.matches, false);
        }

        function toggleThemeSettings() {
            applyTheme(!darkMode, true);
        }

        // ============================================
        // LOGOUT
        // ============================================
        function logoutUser() {
            if (confirm('Are you sure you want to logout?')) {
                auth.signOut().then(() => {
                    localStorage.removeItem('stardust_uid');
                    leaving = true;
                    location.replace('/auth/');
                });
            }
        }

        // ============================================
        // NAVIGATION
        // ============================================
        const PAGE_URL = { dashboard: '/', myapps: '/apps/', upload: '/upload/', analytics: '/analytics/', reviews: '/reviews/', notifications: '/notifications/', profile: '/profile/', settings: '/settings/' };
        function switchPage(page) {
            if (page === currentPage) return;
            location.href = PAGE_URL[page] || '/';
        }

        // Runs once the user is signed in: prepares only the page that is open
        function initPage() {
            if (currentPage === 'dashboard' || currentPage === 'analytics') loadStats();
            if (currentPage === 'dashboard') updateDashboard();
            if (currentPage === 'notifications') renderNotifications();
            if (currentPage === 'analytics') populateAnalyticsSelect();
            if (currentPage === 'reviews' || currentPage === 'hiddenreviews') loadReviews();
            if (currentPage === 'profile') loadProfile();
            if (currentPage === 'myapps') initAppSearch();
            if (currentPage === 'claim') initClaimPage();
        }

        // ============================================
        // LOAD APPS
        // ============================================
        // Keep each app's rating + review count equal to its real reviews (the old default was a fake 4.5)
        const ratingSynced = {};
        function syncRatings() {
            allApps.forEach(app => {
                if (ratingSynced[app.id]) return;
                ratingSynced[app.id] = true;
                db.ref('reviews/' + app.id).once('value').then(snap => {
                    let sum = 0, n = 0;
                    snap.forEach(c => { const r = c.val(); if (r && r.text && !r.hidden) { sum += Math.min(5, Math.max(1, Math.round(+r.rating || 5))); n++; } });
                    const avg = n ? Math.round((sum / n) * 10) / 10 : 0;
                    if (avg !== (+app.rating || 0) || n !== (app.reviewCount || 0)) {
                        return db.ref('apps/' + app.id).update({ rating: avg, reviewCount: n });
                    }
                }).catch(() => { ratingSynced[app.id] = false; });
            });
        }

        // when an app was created: its timestamp, else the time hidden in its Firebase push id, else its upload date
        const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
        function appCreated(a) {
            let t = Number(a.timestamp);
            if (t > 0) return t < 1e11 ? t * 1000 : t; // seconds -> ms
            if (typeof a.timestamp === 'string' && !isNaN(Date.parse(a.timestamp))) return Date.parse(a.timestamp);
            const id = String(a.id || '');
            if (id.length === 20 && id[0] === '-') {
                t = 0;
                for (let i = 0; i < 8; i++) t = t * 64 + PUSH_CHARS.indexOf(id[i]);
                if (t > 1e12 && t < 4e12) return t;
            }
            const d = Date.parse(a.uploadDate || a.updatedDate || '');
            return isNaN(d) ? 0 : d;
        }

        function loadApps() {
            showLoading(true, 'Loading apps...');
            db.ref('apps').on('value', snapshot => {
                const data = snapshot.val();
                allApps = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
                if (currentUser) {
                    allApps = allApps.filter(a => a.developerUid === currentUser.uid);
                }
                // newest apps first (push ids are time-ordered, so they also order older apps that have no timestamp)
                allApps.sort((x, y) => appCreated(y) - appCreated(x) || (x.id < y.id ? 1 : -1));
                syncRatings();
                $('appCountBadge').textContent = allApps.length;
                if (currentPage === 'dashboard') updateDashboard();
                if (currentPage === 'myapps') renderMyApps();
                if (currentPage === 'analytics') populateAnalyticsSelect();
                if (currentPage === 'reviews') { populateReviewSelect(); renderReviews(); }
                if (currentPage === 'hiddenreviews') { populateReviewSelect(); renderHiddenReviews(); }
                showLoading(false);
            }, err => { showLoading(false);
                console.error(err); });
        }

        // ============================================
        // DAILY STATS (written by the store on every download, IST day)
        // ============================================
        const DAY_MS = 86400000, IST_MS = 19800000;
        const dayKey = ts => new Date(ts + IST_MS).toISOString().slice(0, 10);
        let allStats = {};
        function loadStats() {
            db.ref('stats').on('value', snap => {
                allStats = snap.val() || {};
                if (currentPage === 'dashboard') updateDashboard();
                if (currentPage === 'analytics' && $('anaAppSelect').value) loadAppAnalytics();
            }, err => console.warn('stats not readable', err));
        }
        function lastDays(n) {
            const out = [], now = Date.now();
            for (let i = n - 1; i >= 0; i--) {
                const t = now - i * DAY_MS, d = new Date(t + IST_MS);
                out.push({
                    key: dayKey(t),
                    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
                    dm: d.getUTCDate() + '/' + (d.getUTCMonth() + 1)
                });
            }
            return out;
        }
        const dayCount = (ids, key) => ids.reduce((s, id) => s + ((allStats[id] && allStats[id][key]) || 0), 0);
        function barChart(days, values, n) {
            const max = Math.max(1, ...values);
            const every = n <= 7 ? 1 : (n <= 30 ? 5 : 15);
            return '<div class="bars">' + values.map((v, i) => {
                const lbl = n <= 7 ? days[i].weekday : (((days.length - 1 - i) % every === 0) ? days[i].dm : '');
                const h = v ? Math.max(6, Math.round(v / max * 120)) : 3;
                return `<div class="bar-col" title="${days[i].key}: ${v}"><span class="bar-val">${n <= 7 && v ? v : ''}</span><div class="bar${v ? '' : ' zero'}" style="height:${h}px"></div><span class="bar-lbl">${lbl}</span></div>`;
            }).join('') + '</div>';
        }
        function setBadge(el, n) { el.textContent = n; el.style.display = n > 0 ? '' : 'none'; }

        // ============================================
        // DASHBOARD
        // ============================================
        function updateDashboard() {
            const total = allApps.length;
            const downloads = allApps.reduce((s, a) => s + (a.downloadCount || 0), 0);
            const views = allApps.reduce((s, a) => s + (a.views || 0), 0);
            const reviews = allApps.reduce((s, a) => s + (a.reviewCount || 0), 0);
            const ratings = allApps.filter(a => a.rating).map(a => a.rating);
            const avgRating = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length) : 0;
            const live = allApps.filter(a => a.status === 'live' || a.status === 'approved').length;

            const ids = allApps.map(x => x.id);
            let monthly;
            if (Object.keys(allStats).length) {
                monthly = lastDays(30).reduce((s, d) => s + dayCount(ids, d.key), 0);
            } else {
                const monthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                monthly = allApps.reduce((s, x) => (x.downloadDate && new Date(x.downloadDate).getTime() > monthAgo) ? s + (x.downloadCount || 0) : s, 0);
            }

            $('statTotalApps').textContent = total;
            $('statDownloads').textContent = downloads.toLocaleString();
            $('statViews').textContent = views.toLocaleString();
            $('statRating').textContent = avgRating.toFixed(1);
            $('statReviewsCount').textContent = reviews;
            $('statMonthlyDownloads').textContent = monthly.toLocaleString();
            $('statLiveApps').textContent = live;
            $('appCountBadge').textContent = total;

            // Real downloads per day (last 7 days) from the store's daily counter
            const days7 = lastDays(7);
            const vals7 = days7.map(d => dayCount(ids, d.key));
            $('dashChart').innerHTML = barChart(days7, vals7, 7);
            const sum7 = vals7.reduce((s, v) => s + v, 0);
            $('dashChartNote').textContent = sum7
                ? `${sum7} download${sum7 === 1 ? '' : 's'} in the last 7 days`
                : 'No downloads recorded in the last 7 days. Daily tracking starts from the first download after this update.';

            const topApps = [...allApps].sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0)).slice(0, 5);
            const topList = $('topAppsList');
            topList.innerHTML = '';
            if (topApps.length === 0) {
                topList.innerHTML = '<p style="color:var(--text-gray);">No apps yet</p>';
            } else {
                topApps.forEach((app, i) => {
                    topList.innerHTML +=
                        `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-color);">
                            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">${i + 1}. ${escHtml(app.name)}</span>
                            <span style="color:var(--primary);">${app.downloadCount || 0}</span>
                        </div>`;
                });
            }
        }

        // ============================================
        // MY APPS (with instant search)
        // ============================================
        const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        let appQuery = '', appStatus = 'all';

        function initAppSearch() {
            const input = $('appSearch'), status = $('appStatusFilter'), clear = $('appSearchClear');
            const q = new URLSearchParams(location.search).get('q');
            if (q) { input.value = q; appQuery = q.toLowerCase(); }
            let timer;
            input.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => { appQuery = input.value.trim().toLowerCase(); clear.style.display = input.value ? 'block' : 'none'; renderMyApps(); }, 120);
            });
            clear.addEventListener('click', () => { input.value = ''; appQuery = ''; clear.style.display = 'none'; input.focus(); renderMyApps(); });
            status.addEventListener('change', () => { appStatus = status.value; renderMyApps(); });
            clear.style.display = input.value ? 'block' : 'none';
        }

        function appMatches(app) {
            const live = (app.status === 'live' || app.status === 'approved');
            if (appStatus === 'live' && !live) return false;
            if (appStatus === 'draft' && app.status !== 'draft') return false;
            if (!appQuery) return true;
            const hay = [app.name, app.package, app.category, app.version, app.tags, app.shortDescription, app.status].join(' ').toLowerCase();
            return appQuery.split(/\s+/).every(w => hay.includes(w));
        }

        function renderMyApps() {
            const container = $('myAppsList');
            container.innerHTML = '';
            const shown = allApps.filter(appMatches);
            $('appSearchCount').textContent = allApps.length ? (shown.length === allApps.length ? `${allApps.length} apps` : `Showing ${shown.length} of ${allApps.length} apps`) : '';
            if (allApps.length && shown.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                        <h3>No apps found</h3>
                        <p>Nothing matches your search. Try a different name, package or category.</p>
                    </div>`;
                return;
            }
            if (allApps.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                        <h3>No Apps Yet</h3>
                        <p>Upload your first application to get started.</p>
                        <button class="btn-primary" onclick="switchPage('upload')">Upload App</button>
                    </div>
                `;
                return;
            }
            shown.forEach(app => {
                const statusMap = {
                    'live': { class: 'live', label: 'Live' },
                    'approved': { class: 'live', label: 'Live' },
                    'draft': { class: 'draft', label: 'Draft' },
                    'suspended': { class: 'susp', label: 'Suspended' }
                };
                const st = statusMap[app.status] || statusMap['live'];
                const div = document.createElement('div');
                div.className = 'app-list-item';
                div.innerHTML = `
                    <div class="app-info">
                        <img src="${app.icon || 'https://img.icons8.com/color/144/android-os.png'}" onerror="this.src='https://img.icons8.com/color/144/android-os.png'">
                        <div>
                            <div class="app-name">${escHtml(app.name || 'App')}</div>
                            <div class="app-meta">${escHtml(app.package || '')}${app.package ? ' • ' : ''}${escHtml(app.version || 'v1.0')} • ${escHtml(app.size || '0 MB')} • ${app.downloadCount || 0} downloads • ⭐ ${app.rating || 'N/A'}</div>
                        </div>
                    </div>
                    <span class="app-status ${st.class}">${st.label}</span>
                    <div class="app-actions">
                        <button onclick="viewAppDetails('${app.id}')">Details</button>
                        <button onclick="openEditModal('${app.id}')">Edit</button>
                        <button onclick="openUpdateModal('${app.id}')">Update</button>
                        <button onclick="viewAppAnalytics('${app.id}')">Analytics</button>
                        <button class="danger" onclick="deleteApp('${app.id}')">Delete</button>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        // ============================================
        // UPLOAD - Step Wizard
        // ============================================
        // Name shown on the store when the developer leaves the field empty: the profile name
        function profileDevName() {
            return (currentUser && (currentUser.displayName || (currentUser.email || '').split('@')[0])) || 'Developer';
        }

        function nextStep(step) {
            currentStep = step;
            updateSteps();
        }

        function prevStep(step) {
            currentStep = step;
            updateSteps();
        }

        function updateSteps() {
            for (let i = 1; i <= 4; i++) {
                const content = $(`step${i}`);
                const label = $(`step${i}Label`);
                if (content) {
                    content.classList.toggle('active', i === currentStep);
                }
                if (label) {
                    label.classList.remove('active', 'done');
                    if (i === currentStep) label.classList.add('active');
                    else if (i < currentStep) label.classList.add('done');
                }
            }
            if (currentStep > 1) {
                saveDraft();
            }
        }

        function saveDraft() {
            const data = {
                name: $('upName').value,
                category: $('upCategory').value,
                package: $('upPackage').value,
                shortDesc: $('upShortDesc').value,
                longDesc: $('upLongDesc').value,
                developerName: $('upDeveloperName').value,
                tags: $('upTags').value,
                supportEmail: $('upSupportEmail').value,
                privacy: $('upPrivacy').value,
                website: $('upWebsite').value,
                apkUrl: $('upApkUrl').value,
                version: $('upVersion').value,
                size: $('upSize').value,
                youtube: $('upYoutube').value,
                minAndroid: $('upMinAndroid').value,
                permissions: $('upPermissions').value,
                whatsNew: $('upWhatsNew').value,
                status: $('upStatus').value,
                step: currentStep
            };
            drafts['current'] = data;
            localStorage.setItem('stardust_drafts', JSON.stringify(drafts));
        }

        function loadDraft() {
            const data = drafts['current'];
            if (data) {
                if (data.name) $('upName').value = data.name;
                if (data.category) $('upCategory').value = data.category;
                if (data.package) $('upPackage').value = data.package;
                if (data.shortDesc) $('upShortDesc').value = data.shortDesc;
                if (data.longDesc) $('upLongDesc').value = data.longDesc;
                if (data.developerName) $('upDeveloperName').value = data.developerName;
                if (data.tags) $('upTags').value = data.tags;
                if (data.supportEmail) $('upSupportEmail').value = data.supportEmail;
                if (data.privacy) $('upPrivacy').value = data.privacy;
                if (data.website) $('upWebsite').value = data.website;
                if (data.apkUrl) $('upApkUrl').value = data.apkUrl;
                if (data.version) $('upVersion').value = data.version;
                if (data.size) $('upSize').value = data.size;
                if (data.youtube) $('upYoutube').value = data.youtube;
                if (data.minAndroid) $('upMinAndroid').value = data.minAndroid;
                if (data.permissions) { $('upPermissions').value = data.permissions; renderPermChips('up'); }
                if (data.whatsNew) $('upWhatsNew').value = data.whatsNew;
                if (data.status) $('upStatus').value = data.status;
                if (data.step) {
                    currentStep = data.step;
                    updateSteps();
                }
            }
        }

        function previewUploadImage(input, containerId) {
            const container = $(containerId);
            container.innerHTML = '';
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    if (containerId === 'bannerPreview') img.style.cssText = 'width:120px;height:60px;';
                    container.appendChild(img);
                };
                reader.readAsDataURL(input.files[0]);
            }
        }

        function previewUploadScreens_UNUSED(input) {
            const container = $('screensPreview');
            container.innerHTML = '';
            if (input.files) {
                Array.from(input.files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = e => {
                        const img = document.createElement('img');
                        img.className = 'screenshot-preview';
                        img.src = e.target.result;
                        container.appendChild(img);
                    };
                    reader.readAsDataURL(file);
                });
            }
        }

        // ============================================
        // SCREENSHOT MANAGER: add more any time, reorder, remove with x
        // ============================================
        const MAX_SHOTS = 10;
        function createShotManager(boxId, inputId) {
            const box = $(boxId), input = $(inputId);
            const mgr = { items: [] };
            const fkey = f => f.name + '|' + f.size + '|' + f.lastModified;
            const HOLD_MS = 350;
            let drag = null; // active long-press drag state

            function remove(i) {
                const [it] = mgr.items.splice(i, 1);
                if (it && it.file) URL.revokeObjectURL(it.src);
                render();
            }

            // ---- long press, then drag to reorder ----
            function startHold(e, el) {
                if (drag || e.target.closest('.shot-x')) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                drag = { el, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, ghost: null };
                drag.timer = setTimeout(() => activate(), HOLD_MS);
            }
            function activate() {
                if (!drag) return;
                drag.active = true;
                const r = drag.el.getBoundingClientRect();
                drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
                const g = drag.el.cloneNode(true);
                g.classList.add('shot-ghost');
                g.style.width = r.width + 'px';
                document.body.appendChild(g);
                drag.ghost = g;
                drag.el.classList.add('dragging');
                if (navigator.vibrate) { try { navigator.vibrate(15); } catch (x) {} }
                moveGhost();
            }
            function moveGhost() {
                drag.ghost.style.left = (drag.x - drag.dx) + 'px';
                drag.ghost.style.top = (drag.y - drag.dy) + 'px';
                const under = document.elementFromPoint(drag.x, drag.y);
                const t = under && under.closest ? under.closest('.shot') : null;
                if (!t || t === drag.el || t.classList.contains('shot-add') || t.classList.contains('shot-ghost') || t.parentNode !== box) return;
                const kids = Array.from(box.children);
                if (kids.indexOf(drag.el) < kids.indexOf(t)) box.insertBefore(drag.el, t.nextSibling);
                else box.insertBefore(drag.el, t);
            }
            function onMove(e) {
                if (!drag || e.pointerId !== drag.id) return;
                drag.x = e.clientX; drag.y = e.clientY;
                if (!drag.active) {
                    if (Math.abs(drag.x - drag.x0) > 10 || Math.abs(drag.y - drag.y0) > 10) { clearTimeout(drag.timer); drag = null; } // finger is scrolling
                    return;
                }
                e.preventDefault();
                moveGhost();
            }
            function endDrag(e) {
                if (!drag || (e && e.pointerId !== drag.id)) return;
                clearTimeout(drag.timer);
                const was = drag.active;
                if (was) {
                    drag.ghost.remove();
                    const order = Array.from(box.querySelectorAll('.shot:not(.shot-add)')).map(n => n._it).filter(Boolean);
                    if (order.length === mgr.items.length) mgr.items = order;
                }
                drag = null;
                if (was) render();
            }
            box.addEventListener('touchmove', e => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', endDrag);
            window.addEventListener('pointercancel', endDrag);

            function render() {
                box.innerHTML = '';
                box.classList.add('shot-grid');
                mgr.items.forEach((it, i) => {
                    const d = document.createElement('div');
                    d.className = 'shot';
                    d._it = it;
                    d.innerHTML = `<img alt="Screenshot ${i + 1}" draggable="false"><span class="shot-n">${i + 1}</span>
                        <button type="button" class="shot-x" aria-label="Remove screenshot ${i + 1}">×</button>`;
                    d.querySelector('img').src = it.src;
                    d.querySelector('.shot-x').onclick = () => remove(i);
                    d.addEventListener('pointerdown', e => startHold(e, d));
                    d.addEventListener('contextmenu', e => e.preventDefault());
                    box.appendChild(d);
                });
                if (mgr.items.length < MAX_SHOTS) {
                    const add = document.createElement('label');
                    add.className = 'shot shot-add';
                    add.htmlFor = inputId;
                    add.innerHTML = '<span>+</span><small>Add</small>';
                    box.appendChild(add);
                }
                if (mgr.items.length > 1) {
                    const hint = document.createElement('div');
                    hint.className = 'shot-hint';
                    hint.textContent = 'Long press an image, then drag it to change the order. The first one is shown first. Tap × to remove.';
                    box.appendChild(hint);
                }
            }
            input.addEventListener('change', () => {
                Array.from(input.files).forEach(f => {
                    if (mgr.items.length >= MAX_SHOTS) return;
                    if (mgr.items.some(x => x.file && fkey(x.file) === fkey(f))) return;
                    mgr.items.push({ file: f, src: URL.createObjectURL(f) });
                });
                input.value = '';
                render();
            });
            mgr.setExisting = urls => { mgr.items.forEach(it => it.file && URL.revokeObjectURL(it.src)); mgr.items = urls.map(u => ({ url: u, src: u })); render(); };
            mgr.clear = () => mgr.setExisting([]);
            mgr.resolve = () => Promise.all(mgr.items.map(it => it.url ? Promise.resolve(it.url) : uploadToImgBB(it.file)));
            render();
            return mgr;
        }
        const shotsUp = createShotManager('screensPreview', 'upScreenshots');
        const shotsEdit = createShotManager('editScreensPreview', 'editScreenshots');

        function uploadToImgBB(file) {
            return new Promise((resolve, reject) => {
                const formData = new FormData();
                formData.append('image', file);
                fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
                        method: 'POST',
                        body: formData
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            resolve(data.data.url);
                        } else {
                            const reader = new FileReader();
                            reader.onload = e => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        }
                    })
                    .catch(() => {
                        const reader = new FileReader();
                        reader.onload = e => resolve(e.target.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(file);
                    });
            });
        }

        // ---- App permissions picker (shown to users on the store's app page) ----
        const COMMON_PERMISSIONS = ['Internet', 'Storage', 'Camera', 'Microphone', 'Location', 'Contacts', 'Phone', 'SMS', 'Notifications', 'Bluetooth', 'Calendar', 'Vibrate', 'Run in background', 'Display over other apps', 'Install packages'];
        function parsePerms(v) { return String(v || '').split(',').map(x => x.trim()).filter(Boolean); }
        function renderPermChips(p) {
            const box = $(p + 'PermChips'), ta = $(p + 'Permissions');
            if (!box || !ta) return;
            const cur = parsePerms(ta.value).map(x => x.toLowerCase());
            box.innerHTML = '';
            COMMON_PERMISSIONS.forEach(name => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'perm-chip' + (cur.includes(name.toLowerCase()) ? ' on' : '');
                b.textContent = name;
                b.onclick = () => {
                    let list = parsePerms(ta.value);
                    const has = list.some(x => x.toLowerCase() === name.toLowerCase());
                    list = has ? list.filter(x => x.toLowerCase() !== name.toLowerCase()) : list.concat(name);
                    ta.value = list.join(', ');
                    renderPermChips(p);
                };
                box.appendChild(b);
            });
        }
        document.addEventListener('DOMContentLoaded', () => { renderPermChips('up'); renderPermChips('edit'); });
        renderPermChips('up'); renderPermChips('edit');

        function handleUpload(e) {
            e.preventDefault();
            const btn = $('uploadBtnText');
            btn.textContent = 'Publishing...';

            const iconFile = $('upIcon').files[0];
            const bannerFile = $('upBanner').files[0];
            const screenshotFiles = $('upScreenshots').files;

            let iconUrl = 'https://img.icons8.com/color/144/android-os.png';
            let bannerUrl = '';
            let screenshotUrls = [];

            const uploadPromises = [];
            if (iconFile) uploadPromises.push(uploadToImgBB(iconFile).then(url => iconUrl = url));
            if (bannerFile) uploadPromises.push(uploadToImgBB(bannerFile).then(url => bannerUrl = url));
            // keep the exact order the developer arranged
            uploadPromises.push(shotsUp.resolve().then(urls => { screenshotUrls = urls; }));

            Promise.all(uploadPromises).then(() => {
                const packageName = $('upPackage').value.trim();
                const status = $('upStatus').value;
                const finalStatus = status === 'draft' ? 'draft' : 'live';

                const appData = {
                    name: $('upName').value,
                    package: packageName,
                    category: $('upCategory').value,
                    version: $('upVersion').value,
                    shortDescription: $('upShortDesc').value,
                    description: $('upLongDesc').value,
                    whatsNew: $('upWhatsNew').value,
                    downloadUrl: $('upApkUrl').value,
                    size: $('upSize').value || '0 MB',
                    icon: iconUrl,
                    banner: bannerUrl,
                    screenshot: screenshotUrls.join(','),
                    tags: $('upTags').value,
                    supportEmail: $('upSupportEmail').value,
                    privacyPolicy: $('upPrivacy').value,
                    website: $('upWebsite').value,
                    youtube: $('upYoutube').value,
                    minAndroid: $('upMinAndroid').value || '5.0',
                    permissions: $('upPermissions').value.trim(),
                    developerUid: currentUser.uid,
                    developerName: ($('upDeveloperName').value || '').trim() || profileDevName(),
                    downloadCount: 0,
                    reviewCount: 0,
                    views: 0,
                    rating: 0,
                    status: finalStatus,
                    timestamp: Date.now(),
                    updatedDate: new Date().toISOString().split('T')[0],
                    verified: false,
                    versionHistory: [$('upVersion').value]
                };

                db.ref('apps').push(appData).then(() => {
                    btn.textContent = 'Publish App';
                    $('uploadForm').reset();
                    renderPermChips('up');
                    $('iconPreview').innerHTML = '';
                    $('bannerPreview').innerHTML = '';
                    shotsUp.clear();
                    currentStep = 1;
                    updateSteps();

                    delete drafts['current'];
                    localStorage.setItem('stardust_drafts', JSON.stringify(drafts));

                    addActivityLog(`App "${appData.name}" uploaded (${finalStatus})`);

                    if (finalStatus === 'draft') {
                        addNotification(`App "${appData.name}" saved as draft!`);
                        alert('App saved as draft! You can publish it later.');
                    } else {
                        addNotification(`App "${appData.name}" is now LIVE on the store!`);
                        alert('App published successfully! It is now live on UptoZishu. It appears on the website within about 10 minutes.');
                    }
                    switchPage('myapps');
                }).catch(err => {
                    btn.textContent = 'Publish App';
                    alert('Upload failed: ' + err.message);
                });
            }).catch(err => {
                btn.textContent = 'Publish App';
                alert('Image upload failed: ' + err.message);
            });
        }

        // ============================================
        // VIEW APP DETAILS
        // ============================================
        function safeHref(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
        function viewAppDetails(appId) {
            const app = allApps.find(a => a.id === appId);
            if (!app) return;
            const live = app.status === 'live' || app.status === 'approved';
            const val = v => (v === undefined || v === null || String(v).trim() === '') ? '<span class="det-empty">Not set</span>' : escHtml(String(v));
            const n = v => Number(v || 0).toLocaleString();
            const shots = String(app.screenshot || '').split(',').map(x => x.trim()).filter(safeHref);
            const perms = String(app.permissions || '').split(',').map(x => x.trim()).filter(Boolean);
            const link = (label, url, text) => {
                const h = safeHref(url);
                return h ? `<a href="${escHtml(h)}" target="_blank" rel="noopener"><span>${label}</span><span>${escHtml(text || h)}</span></a>` : `<div><span>${label}</span><span class="det-empty">Not set</span></div>`;
            };
            const yt = String(app.youtube || '').trim();
            $('detIcon').src = app.icon || 'https://img.icons8.com/color/144/android-os.png';
            $('detTitle').textContent = app.name || 'App';
            $('detSub').textContent = [app.package, app.version].filter(Boolean).join(' · ');
            const pill = $('detStatus'); pill.textContent = live ? 'Live' : 'Draft'; pill.className = 'pill ' + (live ? 'live' : 'draft');
            $('detBody').innerHTML = `
                <div class="det-stats">
                    <div class="det-stat"><b>${n(app.downloadCount)}</b><span>Downloads</span></div>
                    <div class="det-stat"><b>${n(app.views)}</b><span>Views</span></div>
                    <div class="det-stat"><b>${app.rating ? Number(app.rating).toFixed(1) : '–'}</b><span>Rating</span></div>
                    <div class="det-stat"><b>${n(app.reviewCount)}</b><span>Reviews</span></div>
                </div>
                <div class="det-card"><h5>App info</h5><dl class="det-grid">
                    <div><dt>Category</dt><dd>${val(app.category)}</dd></div>
                    <div><dt>Version</dt><dd>${val(app.version)}</dd></div>
                    <div><dt>File size</dt><dd>${val(app.size)}</dd></div>
                    <div><dt>Minimum Android</dt><dd>${val(app.minAndroid)}</dd></div>
                    <div><dt>Developer</dt><dd>${val(app.developerName)}</dd></div>
                    <div><dt>Last updated</dt><dd>${val(app.updatedDate || app.uploadDate)}</dd></div>
                    <div><dt>Package name</dt><dd>${val(app.package)}</dd></div>
                    <div><dt>Tags</dt><dd>${val(app.tags)}</dd></div>
                </dl></div>
                <div class="det-card"><h5>Short description</h5><p class="det-text">${val(app.shortDescription)}</p></div>
                <div class="det-card"><h5>Long description</h5><p class="det-text">${val(app.description)}</p></div>
                <div class="det-card"><h5>What's new</h5><p class="det-text">${val(app.whatsNew)}</p></div>
                ${shots.length ? `<div class="det-card"><h5>Screenshots (${shots.length})</h5><div class="det-shots">${shots.map(u => `<img src="${escHtml(u)}" alt="Screenshot" loading="lazy">`).join('')}</div></div>` : ''}
                <div class="det-card"><h5>Permissions</h5>${perms.length ? `<div class="det-chips">${perms.map(x => `<span>${escHtml(x)}</span>`).join('')}</div>` : '<span class="det-empty">None listed</span>'}</div>
                <div class="det-card det-links"><h5>Links</h5>
                    ${link('Download (APK)', app.downloadUrl)}
                    ${link('Website', app.website)}
                    ${link('Privacy policy', app.privacyPolicy)}
                    ${app.supportEmail ? `<a href="mailto:${escHtml(app.supportEmail)}"><span>Support email</span><span>${escHtml(app.supportEmail)}</span></a>` : '<div><span>Support email</span><span class="det-empty">Not set</span></div>'}
                    ${yt ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(yt)}" target="_blank" rel="noopener"><span>YouTube video</span><span>${escHtml(yt)}</span></a>` : '<div><span>YouTube video</span><span class="det-empty">Not set</span></div>'}
                </div>`;
            $('detEdit').onclick = () => { closeDetailsModal(); openEditModal(appId); };
            $('detUpdate').onclick = () => { closeDetailsModal(); openEditModal(appId, 'update'); };
            $('detAnalytics').onclick = () => viewAppAnalytics(appId);
            $('detBody').scrollTop = 0;
            $('detailsModal').classList.add('open');
        }
        function closeDetailsModal() { $('detailsModal').classList.remove('open'); }

        // ============================================
        // EDIT APP - Full, only file uploads (no URL fields for images)
        // ============================================
        function openEditModal(appId, mode) {
            const app = allApps.find(a => a.id === appId);
            if (!app) return;
            const isUpdate = mode === 'update';
            editAppId = appId;
            $('editAppId').value = appId;
            $('editName').value = app.name || '';
            $('editCategory').value = app.category || 'Games';
            $('editPackage').value = app.package || '';
            $('editVersion').value = app.version || '';
            $('editShortDesc').value = app.shortDescription || '';
            $('editDeveloperName').value = app.developerName || '';
            $('editLongDesc').value = app.description || '';
            $('editApkUrl').value = app.downloadUrl || '';
            $('editSize').value = app.size || '';
            $('editTags').value = app.tags || '';
            $('editSupportEmail').value = app.supportEmail || '';
            $('editPrivacy').value = app.privacyPolicy || '';
            $('editWebsite').value = app.website || '';
            $('editYoutube').value = app.youtube || '';
            $('editMinAndroid').value = app.minAndroid || '';
            $('editPermissions').value = app.permissions || '';
            renderPermChips('edit');
            $('editWhatsNew').value = app.whatsNew || '';
            $('editStatus').value = app.status || 'live';
            // Clear previews
            $('editIconPreview').innerHTML = '';
            $('editBannerPreview').innerHTML = '';
            // Show current icon as preview if available
            if (app.icon) {
                const img = document.createElement('img');
                img.src = app.icon;
                img.style.width = '60px';
                img.style.height = '60px';
                img.style.borderRadius = '8px';
                img.style.objectFit = 'cover';
                $('editIconPreview').appendChild(img);
            }
            if (app.banner) {
                const img = document.createElement('img');
                img.src = app.banner;
                img.style.width = '120px';
                img.style.height = '60px';
                img.style.borderRadius = '8px';
                img.style.objectFit = 'cover';
                $('editBannerPreview').appendChild(img);
            }
            shotsEdit.setExisting(String(app.screenshot || '').split(',').map(s => s.trim()).filter(Boolean));
            // two modes share this form: plain edit, or publishing a new version
            const modal = $('editModal');
            modal.classList.toggle('mode-update', isUpdate);
            modal.dataset.mode = isUpdate ? 'update' : 'edit';
            $('editHeadIcon').src = app.icon || 'https://img.icons8.com/color/144/android-os.png';
            $('editTitle').textContent = isUpdate ? 'Update app' : 'Edit app';
            $('editSub').textContent = (app.name || 'App') + (app.version ? ' · current ' + app.version : '');
            $('editSaveBtn').textContent = isUpdate ? 'Publish update' : 'Save changes';
            $('relTitle').textContent = isUpdate ? 'New release' : 'Version & download';
            $('relSub').textContent = isUpdate ? 'Fill these first: the new version, its download link and what changed.' : 'The file people download and what changed.';
            $('editModeNote').textContent = 'Publishing an update makes this version live right away. The old version number is kept in your version history. You can also change anything else below, such as the description or screenshots.';
            if (isUpdate) {
                $('editVersion').value = '';
                $('editVersion').placeholder = app.version ? 'Current ' + app.version + ', enter the new one' : 'v1.0.1';
                $('editWhatsNew').value = '';
                $('editStatus').value = 'live';
            }
            // number the sections in the order they appear (the release section moves to the top in update mode)
            const order = (isUpdate ? ['secRelease', 'secBasic'] : ['secBasic', 'secRelease']).concat(['secImages', 'secMore', 'secPerm']).concat(isUpdate ? [] : ['secStatus']);
            order.forEach((id, i) => { const n = $(id).querySelector('.fsec-n'); if (n) n.textContent = i + 1; });
            $('editSaveBtn').disabled = false;
            modal.classList.add('open');
            const body = modal.querySelector('.sheet-body'); if (body) body.scrollTop = 0;
        }

        function closeEditModal() {
            $('editModal').classList.remove('open');
        }

        function previewEditIcon(input) {
            const container = $('editIconPreview');
            container.innerHTML = '';
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.style.width = '60px';
                    img.style.height = '60px';
                    img.style.borderRadius = '8px';
                    img.style.objectFit = 'cover';
                    container.appendChild(img);
                };
                reader.readAsDataURL(input.files[0]);
            }
        }

        function previewEditBanner(input) {
            const container = $('editBannerPreview');
            container.innerHTML = '';
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.style.width = '120px';
                    img.style.height = '60px';
                    img.style.borderRadius = '8px';
                    img.style.objectFit = 'cover';
                    container.appendChild(img);
                };
                reader.readAsDataURL(input.files[0]);
            }
        }

        function previewEditScreens_UNUSED(input) {
            const container = $('editScreensPreview');
            container.innerHTML = '';
            if (input.files) {
                Array.from(input.files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = e => {
                        const img = document.createElement('img');
                        img.className = 'screenshot-preview';
                        img.src = e.target.result;
                        container.appendChild(img);
                    };
                    reader.readAsDataURL(file);
                });
            }
        }

        function saveFullEdit(e) {
            e.preventDefault();
            const id = $('editAppId').value;
            const isUpdate = $('editModal').dataset.mode === 'update';
            const app = allApps.find(a => a.id === id);
            if (!app) return;
            const need = (field, msg) => { const el = $(field); if (!String(el.value || '').trim()) { alert(msg); el.focus(); return true; } return false; };
            if (need('editName', 'Please enter the app name.')) return;
            if (need('editShortDesc', 'Please enter a short description.')) return;
            if (need('editLongDesc', 'Please enter the long description.')) return;
            if (isUpdate) {
                if (need('editVersion', 'Please enter the new version.')) return;
                if (need('editApkUrl', 'Please enter the download link of the new APK.')) return;
                if (need('editWhatsNew', "Please write what's new in this version.")) return;
                const v = $('editVersion').value.trim();
                if (v === String(app.version || '').trim() && !confirm('This version number is the same as the current one. Publish anyway?')) return;
                if ($('editApkUrl').value.trim() === String(app.downloadUrl || '').trim() && !confirm('The download link is the same as before. Publish anyway?')) return;
            }
            const btn = $('editSaveBtn'), label = btn.textContent;
            btn.disabled = true; btn.textContent = isUpdate ? 'Publishing…' : 'Saving…';
            const iconFile = $('editIconFile').files[0];
            const bannerFile = $('editBannerFile').files[0];

            let iconUrl = null;
            let bannerUrl = null;
            let screenshotUrls = [];

            const uploadPromises = [];
            if (iconFile) uploadPromises.push(uploadToImgBB(iconFile).then(url => iconUrl = url));
            if (bannerFile) uploadPromises.push(uploadToImgBB(bannerFile).then(url => bannerUrl = url));
            uploadPromises.push(shotsEdit.resolve().then(urls => { screenshotUrls = urls; }));

            Promise.all(uploadPromises).then(() => {
                const updates = {
                    name: $('editName').value.trim(),
                    category: $('editCategory').value,
                    package: $('editPackage').value.trim(),
                    version: $('editVersion').value.trim(),
                    shortDescription: $('editShortDesc').value.trim(),
                    developerName: ($('editDeveloperName').value || '').trim() || profileDevName(),
                    description: $('editLongDesc').value,
                    downloadUrl: $('editApkUrl').value.trim(),
                    size: $('editSize').value.trim(),
                    tags: $('editTags').value.trim(),
                    supportEmail: $('editSupportEmail').value.trim(),
                    privacyPolicy: $('editPrivacy').value.trim(),
                    website: $('editWebsite').value.trim(),
                    youtube: $('editYoutube').value.trim(),
                    minAndroid: $('editMinAndroid').value.trim(),
                    permissions: $('editPermissions').value.trim(),
                    whatsNew: $('editWhatsNew').value,
                    status: isUpdate ? 'live' : $('editStatus').value,
                    updatedDate: new Date().toISOString().split('T')[0]
                };
                // Only update images if new files were uploaded
                if (iconUrl) updates.icon = iconUrl;
                if (bannerUrl) updates.banner = bannerUrl;
                updates.screenshot = screenshotUrls.join(','); // full ordered list (removed screenshots are gone, new ones are added)
                if (isUpdate) {
                    const history = Array.isArray(app.versionHistory) ? app.versionHistory.slice() : [];
                    if (app.version && app.version !== updates.version) history.push(app.version);
                    updates.versionHistory = history;
                }

                return db.ref(`apps/${id}`).update(updates).then(() => {
                    if (isUpdate) {
                        addActivityLog(`Update for "${updates.name}" to ${updates.version} published`);
                        addNotification(`Update for "${updates.name}" is now LIVE!`);
                    } else {
                        addActivityLog(`App "${updates.name}" fully edited`);
                        addNotification(`App "${updates.name}" updated successfully!`);
                    }
                    closeEditModal();
                    renderMyApps();
                    alert(isUpdate ? 'Update published successfully!' : 'App updated successfully!');
                });
            }).catch(err => {
                alert((isUpdate ? 'Could not publish the update: ' : 'Could not save: ') + err.message);
            }).then(() => { btn.disabled = false; btn.textContent = label; });
        }

        // ============================================
        // UPDATE APP
        // ============================================
        function openUpdateModal(appId) { openEditModal(appId, 'update'); }

        // ============================================
        // DELETE APP
        // ============================================
        function deleteApp(appId) {
            if (!confirm('Delete this app permanently? This cannot be undone.')) return;
            const app = allApps.find(a => a.id === appId);
            db.ref(`apps/${appId}`).remove().then(() => {
                if (app) addActivityLog(`App "${app.name}" deleted`);
                addNotification('App deleted.');
                renderMyApps();
            });
        }

        // ============================================
        // ANALYTICS
        // ============================================
        function populateAnalyticsSelect() {
            const select = $('anaAppSelect');
            const keep = select.value;
            select.innerHTML = '<option value="">Select App</option>';
            allApps.forEach(app => {
                select.innerHTML += `<option value="${app.id}">${escHtml(app.name)}</option>`;
            });
            if (keep) select.value = keep;
            const pre = new URLSearchParams(location.search).get('app');
            if (pre && !populateAnalyticsSelect.done && allApps.some(a => a.id === pre)) {
                populateAnalyticsSelect.done = true;
                select.value = pre;
                loadAppAnalytics();
            }
        }

        function viewAppAnalytics(appId) {
            location.href = '/analytics/?app=' + encodeURIComponent(appId);
        }

        let anaDays = 7;
        function setAnaPeriod(n) { anaDays = n; loadAppAnalytics(); }


        // all reviews of the selected app, live, with reply + hide (same controls as the Reviews page)
        let anaRevRef = null;
        function loadAnaReviews(appId) {
            if (anaRevRef) anaRevRef.off();
            anaRevRef = db.ref('reviews/' + appId);
            anaRevRef.on('value', snap => {
                allReviews[appId] = snap.val() || {};
                if (currentPage === 'analytics' && $('anaAppSelect').value === appId) renderAnaReviews(appId);
            });
        }
        function renderAnaReviews(appId) {
            const box = $('anaReviews');
            if (!box || !appId) return;
            const app = allApps.find(a => a.id === appId);
            const bucket = allReviews[appId] || {};
            const list = Object.keys(bucket).filter(k => bucket[k] && typeof bucket[k] === 'object').map(k => ({ ...bucket[k], id: k, appId }));
            box.innerHTML = '';
            if (!list.length) { box.innerHTML = '<div class="chart-note">No reviews on this app yet.</div>'; return; }
            list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(rev => box.appendChild(reviewItem(rev, app && app.name, false)));
        }

        function loadAppAnalytics() {
            const appId = $('anaAppSelect').value;
            const container = $('analyticsContainer');
            if (!appId) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>
                        <h3>Select an App</h3>
                        <p>Choose an app from the dropdown to see analytics.</p>
                    </div>
                `;
                return;
            }
            const app = allApps.find(a => a.id === appId);
            if (!app) return;

            const days = lastDays(anaDays);
            const vals = days.map(d => dayCount([appId], d.key));
            const total = vals.reduce((s, v) => s + v, 0);
            const best = Math.max(0, ...vals);
            const bestDay = best ? days[vals.indexOf(best)].dm : '-';
            const today = vals[vals.length - 1];

            container.innerHTML = `
                <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:20px;">
                    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
                        <img src="${escHtml(app.icon || 'https://img.icons8.com/color/144/android-os.png')}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;border:1px solid var(--border-color);">
                        <div style="min-width:0">
                            <div style="font-size:18px;font-weight:600;overflow-wrap:anywhere">${escHtml(app.name)}</div>
                            <div style="color:var(--text-gray);">${escHtml(app.version || 'v1.0')} • ${escHtml(app.category || 'General')}</div>
                        </div>
                    </div>
                    <div class="stats-grid" style="margin-bottom:16px;">
                        <div class="stat-card"><div class="stat-value">${app.downloadCount || 0}</div><div class="stat-label">Downloads</div></div>
                        <div class="stat-card"><div class="stat-value">${app.views || 0}</div><div class="stat-label">Views</div></div>
                        <div class="stat-card"><div class="stat-value">${app.rating || 'N/A'}</div><div class="stat-label">Rating</div></div>
                        <div class="stat-card"><div class="stat-value">${app.reviewCount || 0}</div><div class="stat-label">Reviews</div></div>
                    </div>
                    <h4 style="margin-bottom:8px;">Downloads per day</h4>
                    <div class="period-tabs">
                        ${[7, 30, 90].map(n => `<button class="${n === anaDays ? 'active' : ''}" onclick="setAnaPeriod(${n})">${n} days</button>`).join('')}
                    </div>
                    ${barChart(days, vals, anaDays)}
                    <div class="ana-sum">
                        <div><b>${total}</b><span>Last ${anaDays} days</span></div>
                        <div><b>${today}</b><span>Today</span></div>
                        <div><b>${best}</b><span>Best day${best ? ' (' + bestDay + ')' : ''}</span></div>
                    </div>
                    ${total === 0 ? '<div class="chart-note">No downloads recorded in this period yet. Daily tracking starts from the first download after the update.</div>' : ''}
                    <h4 style="margin:20px 0 6px;">Rating breakdown</h4>
                    <div id="anaRatings" class="chart-note">Loading…</div>
                </div>
                <div class="ana-reviews">
                    <h4 style="margin:22px 0 10px;">Reviews</h4>
                    <div id="anaReviews"></div>
                </div>
            `;
            loadAnaReviews(appId);

            db.ref('reviews/' + appId).once('value').then(snap => {
                const box = $('anaRatings');
                const rv = Object.values(snap.val() || {});
                if (!rv.length) { box.textContent = 'No reviews yet.'; return; }
                const cnt = [0, 0, 0, 0, 0, 0];
                rv.forEach(r => { const s = Math.min(5, Math.max(1, Math.round(r.rating || 5))); cnt[s]++; });
                const avg = (rv.reduce((s, r) => s + (Number(r.rating) || 5), 0) / rv.length).toFixed(1);
                box.className = '';
                box.innerHTML = `<div style="font-size:13px;margin-bottom:6px;"><b>${avg}</b> ★ from ${rv.length} review${rv.length === 1 ? '' : 's'}</div>` +
                    [5, 4, 3, 2, 1].map(s => `<div class="rate-row"><span style="width:24px">${s} ★</span><div class="track"><div class="fill" style="width:${Math.round(cnt[s] / rv.length * 100)}%"></div></div><span style="width:22px;text-align:right">${cnt[s]}</span></div>`).join('');
            }).catch(() => { $('anaRatings').textContent = 'Could not load reviews.'; });
        }

        // ============================================
        // REVIEWS
        // ============================================
        function populateReviewSelect() {
            const select = $('reviewAppSelect');
            const keep = select.value;
            select.innerHTML = '<option value="">All apps</option>';
            allApps.forEach(app => {
                select.innerHTML += `<option value="${escHtml(app.id)}">${escHtml(app.name)}</option>`;
            });
            if (keep) select.value = keep;
            const pre = new URLSearchParams(location.search).get('app');
            if (pre && !keep && allApps.some(a => a.id === pre)) select.value = pre;
        }

        // Reviews are stored as reviews/<appId>/<reviewId>; listen once to all of them and show the developer's apps only
        function loadReviews() {
            db.ref('reviews').off('value');
            db.ref('reviews').on('value', snapshot => {
                allReviews = snapshot.val() || {};
                if (currentPage === 'reviews') renderReviews();
                if (currentPage === 'hiddenreviews') renderHiddenReviews();
            }, err => {
                $('reviewsList').innerHTML = '<div class="empty-state"><h3>Could not load reviews</h3><p>' + escHtml(err && err.message || '') + '</p></div>';
            });
        }

        function renderReviews() {
            const container = $('reviewsList');
            container.innerHTML = '';

            const names = {};
            allApps.forEach(a => { names[a.id] = a.name; });
            const selected = $('reviewAppSelect').value;
            let allRev = [];
            Object.keys(names).forEach(appId => {
                if (selected && selected !== appId) return;
                const bucket = allReviews[appId] || {};
                Object.keys(bucket).forEach(revId => allRev.push({ ...bucket[revId], id: revId, appId }));
            });

            // red badge = reviews without a reply, across all apps
            let unreplied = 0;
            Object.keys(names).forEach(appId => Object.values(allReviews[appId] || {}).forEach(r => { if (!r.reply) unreplied++; }));
            setBadge($('reviewBadge'), unreplied);
            const hc = $('hiddenCount'); if (hc) { let n = 0; Object.keys(names).forEach(appId => Object.values(allReviews[appId] || {}).forEach(r => { if (r && r.hidden) n++; })); hc.textContent = n; }

            if (currentReviewFilter !== 'all') {
                const star = parseInt(currentReviewFilter);
                allRev = allRev.filter(r => Math.round(r.rating || 5) === star);
            }

            if (allRev.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                        <h3>No Reviews</h3>
                        <p>${selected ? "This app doesn't have any reviews yet." : 'No reviews on your apps yet.'}</p>
                    </div>
                `;
                return;
            }

            allRev.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(rev => {
                container.appendChild(reviewItem(rev, names[rev.appId], !selected));
            });
            focusReviewFromUrl();
        }

        // one review card with reply + hide controls (used by the Reviews page and by Analytics)
        function reviewItem(rev, appName, showApp) {
                let stars = '';
                for (let i = 0; i < 5; i++) stars += i < Math.round(rev.rating || 5) ? '★' : '☆';
                const when = rev.timestamp ? new Date(rev.timestamp).toLocaleDateString() : '';
                const div = document.createElement('div');
                div.className = 'review-item';
                div.innerHTML = `
                    ${showApp ? `<div class="rev-app">${escHtml(appName || '')}</div>` : ''}
                    <div class="rev-head">
                        <span class="rev-user">${escHtml(rev.author || 'Anonymous')}${when ? ` <small style="color:var(--text-gray);font-weight:400">• ${escHtml(when)}</small>` : ''}</span>
                        <span class="rev-stars">${stars}</span>
                    </div>
                    <div class="rev-text">${escHtml(rev.text || '')}</div>
                    ${rev.reply ? `<div class="dev-reply"><strong>Developer Reply:</strong> ${escHtml(rev.reply)}</div>` : ''}
                    <div class="rev-reply">
                        <input type="text" placeholder="${rev.reply ? 'Edit your reply...' : 'Reply to this review...'}" id="replyInput_${escHtml(rev.id)}" />
                        <button onclick="submitReply('${escHtml(rev.appId)}','${escHtml(rev.id)}')">Reply</button>
                    </div>
                                  <div class="rev-tools">
                        <button type="button" class="rev-hide${rev.hidden ? ' is-hidden' : ''}" onclick="toggleHideReview('${escHtml(rev.appId)}','${escHtml(rev.id)}',${rev.hidden ? 'false' : 'true'})">
                            <svg viewBox="0 0 24 24" aria-hidden="true">${rev.hidden ? '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' : '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z"/>'}</svg>
                            ${rev.hidden ? 'Unhide' : 'Hide from store'}
                        </button>
                        ${rev.hidden ? '<span class="rev-hidden-note">Hidden: people on the store cannot see this review</span>' : ''}
                    </div>
                `;
                if (rev.hidden) div.classList.add('hidden-rev');
                div.id = 'rev_' + rev.id;
                return div;
        }

        // coming from a review notification: open that app's reviews and highlight the review
        let focusDone = false;
        function focusReviewFromUrl() {
            if (focusDone) return;
            const id = new URLSearchParams(location.search).get('review');
            if (!id) { focusDone = true; return; }
            const el = document.getElementById('rev_' + id);
            if (!el) return;
            focusDone = true;
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            el.classList.add('rev-focus');
            setTimeout(() => el.classList.remove('rev-focus'), 3500);
        }


        // screen with all hidden reviews, where the developer can unhide them
        function renderHiddenReviews() {
            const container = $('reviewsList');
            if (!container) return;
            container.innerHTML = '';
            const names = {};
            allApps.forEach(a => { names[a.id] = a.name; });
            const selected = $('reviewAppSelect').value;
            const list = [];
            Object.keys(names).forEach(appId => {
                if (selected && selected !== appId) return;
                const bucket = allReviews[appId] || {};
                Object.keys(bucket).forEach(k => { const r = bucket[k]; if (r && typeof r === 'object' && r.hidden) list.push({ ...r, id: k, appId }); });
            });
            let unreplied = 0;
            Object.keys(names).forEach(appId => Object.values(allReviews[appId] || {}).forEach(r => { if (!r.reply) unreplied++; }));
            setBadge($('reviewBadge'), unreplied);
            if (!list.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z"/></svg>
                        <h3>No hidden reviews</h3>
                        <p>Reviews you hide will show up here.</p>
                    </div>`;
                return;
            }
            list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(rev => container.appendChild(reviewItem(rev, names[rev.appId], !selected)));
        }

        function filterReviews(star) {
            currentReviewFilter = star;
            document.querySelectorAll('.review-filter button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.star == star);
            });
            renderReviews();
        }


        function rerenderReviews() { if (currentPage === 'analytics') renderAnaReviews($('anaAppSelect').value); else if (currentPage === 'hiddenreviews') renderHiddenReviews(); else renderReviews(); }

        // hide / unhide a review: hidden reviews are removed from the store page and from the rating
        function toggleHideReview(appId, revId, hide) {
            if (hide && !confirm('Hide this review? It will disappear from the store and will not count in the rating. You can unhide it any time.')) return;
            const ref = db.ref(`reviews/${appId}/${revId}/hidden`);
            (hide ? ref.set(true) : ref.remove()).then(() => {
                if (allReviews[appId] && allReviews[appId][revId]) { if (hide) allReviews[appId][revId].hidden = true; else delete allReviews[appId][revId].hidden; }
                rerenderReviews();
                // keep the app's rating and review count in step with what the store shows
                let sum = 0, n = 0;
                Object.values(allReviews[appId] || {}).forEach(r => { if (r && r.text && !r.hidden) { sum += Math.min(5, Math.max(1, Math.round(+r.rating || 5))); n++; } });
                db.ref('apps/' + appId).update({ rating: n ? Math.round((sum / n) * 10) / 10 : 0, reviewCount: n }).catch(() => {});
                alert(hide ? 'Review hidden. It will disappear from the store in a few minutes. You can unhide it from the Hidden reviews screen.' : 'Review is visible again. It will show in the store in a few minutes.');
            }).catch(() => alert('Could not update the review. Please publish the latest Firebase rules and try again.'));
        }

        function submitReply(appId, revId) {
            const input = $(`replyInput_${revId}`);
            if (!input || !input.value.trim()) return;
            const replyText = input.value.trim();

            db.ref(`reviews/${appId}/${revId}/reply`).set(replyText).then(() => {
                input.value = '';
                addNotification('Reply sent successfully!');
            });
        }

        // ============================================
        // NOTIFICATIONS
        // ============================================
        function loadNotifications() {
            if (!currentUser) return;
            db.ref(`notifications/${currentUser.uid}`).on('value', snapshot => {
                const data = snapshot.val();
                allNotifications = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) : [];
                setBadge($('notifBadge'), allNotifications.filter(n => !n.read).length);
                if (currentPage === 'notifications') renderNotifications();
            });
        }

        function addNotification(text) {
            if (!currentUser) return;
            db.ref(`notifications/${currentUser.uid}`).push({
                text: text,
                timestamp: Date.now(),
                read: false
            });
        }

        function renderNotifications() {
            const container = $('notificationsList');
            container.innerHTML = '';
            const clearBtn = $('notifClearAll'), tip = $('notifTip');
            if (clearBtn) clearBtn.style.display = allNotifications.length ? '' : 'none';
            if (tip) tip.style.display = allNotifications.length ? '' : 'none';
            if (allNotifications.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
                        <h3>No Notifications</h3>
                        <p>You're all caught up!</p>
                    </div>
                `;
                return;
            }
            allNotifications.forEach(n => {
                const div = document.createElement('div');
                const isRev = n.type === 'review' && n.appId;
                div.className = 'notif-item' + (isRev ? ' notif-link' : '') + (n.read ? '' : ' unread');
                const stars = isRev && n.rating ? '★'.repeat(Math.round(n.rating)) + '☆'.repeat(5 - Math.round(n.rating)) : '';
                const sub = isRev ? `<div class="notif-sub">${stars ? `<span class="notif-stars">${stars}</span> ` : ''}${n.snippet ? escHtml(n.snippet) : ''}<span class="notif-go">View review ›</span></div>` : '';
                div.innerHTML = `
                    <div class="notif-icon">
                        ${isRev ? '<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>'}
                    </div>
                    <div class="notif-main"><div class="notif-text">${escHtml(n.text)}</div>${sub}</div>
                    <div class="notif-time">${new Date(n.timestamp).toLocaleDateString()}</div>
                `;
                attachNotifPress(div, n);
                container.appendChild(div);
            });
            // mark the unread ones as read (only existing ones, so a deleted notification never comes back)
            allNotifications.filter(n => !n.read).forEach(n => {
                db.ref(`notifications/${currentUser.uid}/${n.id}`).once('value').then(snap => {
                    if (snap.val()) db.ref(`notifications/${currentUser.uid}/${n.id}/read`).set(true);
                });
            });
            setBadge($('notifBadge'), 0);
        }

        // long press (or right click) on a notification -> small menu to delete just that one
        function attachNotifPress(el, n) {
            let timer = 0, sx = 0, sy = 0, longAt = 0;
            const cancel = () => { clearTimeout(timer); el.classList.remove('pressing'); };
            el.addEventListener('pointerdown', e => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                sx = e.clientX; sy = e.clientY;
                el.classList.add('pressing');
                timer = setTimeout(() => { longAt = Date.now(); el.classList.remove('pressing'); if (navigator.vibrate) try { navigator.vibrate(15); } catch (x) {} openNotifMenu(n); }, 450);
            });
            el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) cancel(); });
            ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, cancel));
            el.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); longAt = Date.now(); openNotifMenu(n); });
            // tap a review notification -> open that review
            if (n.type === 'review' && n.appId) {
                el.addEventListener('click', () => {
                    if (Date.now() - longAt < 800) return; // this was a long press, not a tap
                    location.href = '/reviews/?app=' + encodeURIComponent(n.appId) + (n.revId ? '&review=' + encodeURIComponent(n.revId) : '');
                });
            }
        }
        function closeNotifMenu() { const m = document.getElementById('notifMenu'); if (m) m.remove(); }
        function openNotifMenu(n) {
            closeNotifMenu();
            const m = document.createElement('div');
            m.id = 'notifMenu'; m.className = 'nmenu-overlay';
            m.innerHTML = `<div class="nmenu" role="dialog" aria-modal="true" aria-label="Notification options">
                <p class="nmenu-text">${escHtml(n.text)}</p>
                <button type="button" class="nmenu-del" data-a="del">Delete this notification</button>
                <button type="button" class="nmenu-cancel" data-a="x">Cancel</button>
            </div>`;
            m.addEventListener('click', e => {
                const a = e.target.closest('[data-a]');
                if (e.target === m || (a && a.dataset.a === 'x')) { closeNotifMenu(); return; }
                if (a && a.dataset.a === 'del') {
                    closeNotifMenu();
                    db.ref(`notifications/${currentUser.uid}/${n.id}`).remove().catch(() => alert('Could not delete the notification. Please try again.'));
                }
            });
            document.body.appendChild(m);
        }
        function clearAllNotifications() {
            if (!allNotifications.length) return;
            if (!confirm('Delete all notifications? This cannot be undone.')) return;
            db.ref(`notifications/${currentUser.uid}`).remove().catch(() => alert('Could not clear notifications. Please try again.'));
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotifMenu(); });


        // ============================================
        // CLAIM AN APP (developer) + CLAIM REQUESTS (store admin)
        // The admin is whoever has admins/<uid> = true in Firebase (set by hand in the Firebase console).
        // ============================================
        let storeApps = [], myClaims = {}, claimApp = null;
        const claimKey = s => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');
        const claimWhen = t => t ? new Date(+t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const hostOf = u => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
        const baseDomain = h => h.split('.').slice(-2).join('.');

        // ---------- developer side ----------
        function initClaimPage() {
            db.ref('apps').once('value').then(snap => {
                storeApps = Object.entries(snap.val() || {}).map(([id, a]) => ({ id, ...a })).filter(a => a.developerUid !== currentUser.uid);
                const pre = new URLSearchParams(location.search).get('app');
                if (pre) { const a = storeApps.find(x => x.id === pre); if (a) { $('claimSearch').value = a.name || ''; } }
                renderClaimResults();
                if (pre && storeApps.some(x => x.id === pre) && !myClaims[pre]) openClaimModal(pre);
            });
            $('claimSearch').addEventListener('input', renderClaimResults);
            db.ref('claims/' + currentUser.uid).on('value', snap => { myClaims = snap.val() || {}; renderMyClaims(); renderClaimResults(); });
        }
        function claimPill(st) { return st === 'approved' ? '<span class="pill live">Approved</span>' : st === 'rejected' ? '<span class="pill rej">Rejected</span>' : '<span class="pill draft">Pending</span>'; }
        function renderClaimResults() {
            const box = $('claimResults'), q = $('claimSearch').value.trim().toLowerCase();
            if (q.length < 2) { box.innerHTML = '<div class="chart-note">Type the name or package of your app to find it.</div>'; return; }
            const list = storeApps.filter(a => [a.name, a.package, a.developerName].join(' ').toLowerCase().includes(q)).slice(0, 30);
            if (!list.length) { box.innerHTML = '<div class="chart-note">No app found. Check the spelling, or upload it as a new app.</div>'; return; }
            box.innerHTML = list.map(a => {
                const c = myClaims[a.id];
                const act = c && c.status === 'pending' ? claimPill('pending') : c && c.status === 'approved' ? claimPill('approved') : `<button type="button" class="btn-primary claim-go" onclick="openClaimModal('${escHtml(a.id)}')">${c && c.status === 'rejected' ? 'Claim again' : 'Claim'}</button>`;
                return `<div class="claim-app"><img src="${escHtml(a.icon || 'https://img.icons8.com/color/144/android-os.png')}" alt=""><div class="claim-app-info"><b>${escHtml(a.name || 'App')}</b><span>${escHtml(a.package || '')}</span><span>Listed by ${escHtml(a.developerName || 'unknown')}</span></div>${act}</div>`;
            }).join('');
        }
        function renderMyClaims() {
            const box = $('myClaims'), list = Object.keys(myClaims).map(k => ({ ...myClaims[k], key: k })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            if (!list.length) { box.innerHTML = '<div class="chart-note">No claim requests yet.</div>'; return; }
            box.innerHTML = list.map(c => `<div class="claim-app"><img src="${escHtml(c.icon || 'https://img.icons8.com/color/144/android-os.png')}" alt=""><div class="claim-app-info"><b>${escHtml(c.appName || 'App')}</b><span>Sent ${claimWhen(c.timestamp)}</span>${c.status === 'rejected' && c.reason ? `<span class="claim-reason">Reason: ${escHtml(c.reason)}</span>` : ''}${c.status === 'approved' ? '<span>Now in your My Apps.</span>' : ''}</div>${claimPill(c.status)}${c.status === 'pending' ? `<button type="button" class="btn-ghost claim-go" onclick="withdrawClaim('${escHtml(c.key)}')">Withdraw</button>` : ''}</div>`).join('');
        }
        function openClaimModal(appId) {
            const a = storeApps.find(x => x.id === appId); if (!a) return;
            claimApp = a;
            $('claimIcon').src = a.icon || 'https://img.icons8.com/color/144/android-os.png';
            $('claimTitle').textContent = 'Claim ' + (a.name || 'app');
            $('claimSub').textContent = a.package || '';
            $('claimEmail').value = (currentUser.email || '');
            $('claimProof').value = ''; $('claimMessage').value = ''; $('claimConfirm').checked = false; $('claimError').textContent = '';
            $('claimSendBtn').disabled = false; $('claimSendBtn').textContent = 'Send claim';
            $('claimModal').classList.add('open');
        }
        function closeClaimModal() { $('claimModal').classList.remove('open'); }
        function submitClaim(e) {
            e.preventDefault();
            const err = $('claimError'), a = claimApp; if (!a) return;
            const email = $('claimEmail').value.trim(), proof = $('claimProof').value.trim(), msg = $('claimMessage').value.trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Enter a valid contact email.'; return; }
            if (!/^https?:\/\/\S+\.\S+/i.test(proof)) { err.textContent = 'Enter the proof link, starting with https://'; return; }
            if (msg.length < 15) { err.textContent = 'Please write a short message (at least 15 characters).'; return; }
            if (!$('claimConfirm').checked) { err.textContent = 'Please tick the confirmation box.'; return; }
            const btn = $('claimSendBtn'); btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
            db.ref('users/' + currentUser.uid).once('value').catch(() => null).then(us => {
                const u = (us && us.val()) || {};
                return db.ref('claims/' + currentUser.uid + '/' + a.id).set({
                    appId: a.id, appName: String(a.name || '').slice(0, 100), package: String(a.package || '').slice(0, 150), icon: String(a.icon || '').slice(0, 500),
                    currentOwner: String(a.developerUid || ''), currentOwnerName: String(a.developerName || '').slice(0, 80),
                    claimantUid: currentUser.uid, claimantName: String(u.name || currentUser.displayName || 'Developer').slice(0, 60), claimantUsername: String(u.username || ''),
                    claimantEmail: String(currentUser.email || '').slice(0, 120), contactEmail: email.slice(0, 120), role: $('claimRole').value, proofUrl: proof.slice(0, 400), message: msg,
                    status: 'pending', timestamp: Date.now()
                });
            }).then(() => { closeClaimModal(); alert('Claim sent. The store admin will check it, and you will get a notification.'); })
              .catch(x => { btn.disabled = false; btn.textContent = 'Send claim'; err.textContent = 'Could not send the claim. Please try again. (' + ((x && x.message) || 'error') + ')'; });
        }
        function withdrawClaim(appId) {
            if (!confirm('Withdraw this claim request?')) return;
            db.ref('claims/' + currentUser.uid + '/' + appId).remove().catch(() => alert('Could not withdraw. Please try again.'));
        }


        // ============================================
        // ACTIVITY LOG
        // ============================================
        function addActivityLog(action) {
            activityLog.unshift({ action, timestamp: Date.now() });
            if (activityLog.length > 100) activityLog.pop();
            localStorage.setItem('stardust_activity_log', JSON.stringify(activityLog));
        }

        function viewActivityLog() {
            if (activityLog.length === 0) {
                alert('No activity logged yet.');
                return;
            }
            let msg = 'Recent Activity:\n\n';
            activityLog.slice(0, 20).forEach(log => {
                const date = new Date(log.timestamp).toLocaleString();
                msg += `• ${date}: ${log.action}\n`;
            });
            alert(msg);
        }

        function viewDrafts() {
            const draftKeys = Object.keys(drafts);
            if (draftKeys.length === 0) {
                alert('No drafts saved.');
                return;
            }
            let msg = 'Saved Drafts:\n\n';
            draftKeys.forEach(key => {
                const d = drafts[key];
                msg += `• ${d.name || 'Untitled'} (Step ${d.step || 1})\n`;
            });
            msg += '\nClick "Upload App" to continue your draft.';
            alert(msg);
        }

        // ============================================
        // PROFILE
        // ============================================
        function loadProfile() {
            if (!currentUser) return;
            db.ref(`users/${currentUser.uid}`).once('value').then(us => {
                const u = us.val() || {};
                $('profUsername').value = u.username ? '@' + u.username : '';
                return u;
            }).catch(() => ({})).then(u => db.ref(`developers/${currentUser.uid}`).once('value').then(snap => {
                const data = snap.val() || {};
                $('profName').value = data.displayName || u.name || currentUser.displayName || '';
                $('profBio').value = data.bio || u.bio || '';
                $('profWebsite').value = data.website || '';
                $('profGithub').value = data.github || '';
                $('profEmail').value = data.supportEmail || currentUser.email || '';
                $('profCountry').value = data.country || '';
                if (data.photoURL) {
                    $('profilePfpPreview').src = data.photoURL;
                }
            }));
        }

        function previewProfilePfp(input) {
            if (input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = e => {
                    $('profilePfpPreview').src = e.target.result;
                    window._tempPfp = e.target.result;
                };
                reader.readAsDataURL(input.files[0]);
            }
        }

        function saveProfile() {
            if (!currentUser) return;
            const data = {
                displayName: $('profName').value,
                bio: $('profBio').value,
                website: $('profWebsite').value,
                github: $('profGithub').value,
                supportEmail: $('profEmail').value,
                country: $('profCountry').value,
                updatedAt: Date.now()
            };
            if (window._tempPfp) {
                data.photoURL = window._tempPfp;
                window._tempPfp = null;
            }
            db.ref(`developers/${currentUser.uid}`).update(data).then(() => {
                if (data.displayName) {
                    currentUser.updateProfile({ displayName: data.displayName });
                }
                // keep the public store profile in sync (username itself never changes)
                if (window._devUsername) db.ref(`users/${currentUser.uid}`).update({ name: String(data.displayName || '').slice(0, 40), bio: String(data.bio || '').slice(0, 140) }).catch(() => {});
                addNotification('Profile updated successfully!');
                alert('Profile saved!');
                loadProfile();
            });
        }

        // ============================================
        // SETTINGS
        // ============================================
        function changePassword() {
            const currentPw = prompt('Enter current password:');
            if (!currentPw) return;
            const newPw = prompt('Enter new password (min 6 chars):');
            if (!newPw || newPw.length < 6) { alert('Password must be at least 6 characters.'); return; }
            const confirmPw = prompt('Confirm new password:');
            if (newPw !== confirmPw) { alert('Passwords do not match.'); return; }

            const user = auth.currentUser;
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPw);
            user.reauthenticateWithCredential(credential).then(() => {
                user.updatePassword(newPw).then(() => {
                    addNotification('Password changed successfully!');
                    alert('Password changed!');
                }).catch(err => alert('Error: ' + err.message));
            }).catch(err => alert('Current password is incorrect.'));
        }

        function changeEmail() {
            const newEmail = prompt('Enter new email address:');
            if (!newEmail || !newEmail.includes('@')) { alert('Invalid email address.'); return; }
            const user = auth.currentUser;
            user.updateEmail(newEmail).then(() => {
                db.ref(`developers/${user.uid}/email`).set(newEmail);
                addNotification('Email updated successfully!');
                alert('Email updated!');
                $('userDisplayEmail').textContent = newEmail;
            }).catch(err => alert('Error: ' + err.message));
        }

        function deleteAccount() {
            if (!confirm('Are you sure you want to delete your account? This cannot be undone!')) return;
            if (!confirm('All your apps and data will be permanently deleted. This is also your UptoZishu store account: your store profile and username will be removed too. Continue?')) return;

            const user = auth.currentUser;
            db.ref(`developers/${user.uid}`).remove();
            db.ref(`notifications/${user.uid}`).remove();
            if (window._devUsername) db.ref(`usernames/${window._devUsername}`).remove().catch(() => {});
            db.ref(`users/${user.uid}`).remove().catch(() => {});
            allApps.forEach(app => {
                if (app.developerUid === user.uid) {
                    db.ref(`apps/${app.id}`).remove();
                }
            });
            user.delete().then(() => {
                localStorage.removeItem('stardust_uid');
                alert('Account deleted successfully.');
                leaving = true;
                location.replace('/auth/');
            }).catch(err => {
                alert('Error deleting account: ' + err.message);
            });
        }

        function changeLanguage() {
            const lang = prompt('Select language (en, hi, es, fr, de):', 'en');
            if (lang) {
                localStorage.setItem('stardust_lang', lang);
                addNotification(`Language changed to ${lang}`);
                alert(`Language set to ${lang}`);
            }
        }

        // ============================================
        // INIT
        // ============================================
        document.addEventListener('DOMContentLoaded', () => {
            loadDraft(); // the loading screen stays until Firebase says who is signed in
        });

        console.log('🚀 UptoZishu Console loaded');
        console.log('📦 Features: Dashboard, App Management, Upload Wizard, Analytics, Reviews, Notifications, Profile, Settings');
        console.log('🔄 Real-time: Apps sync automatically with Firebase');
        console.log('📝 Drafts: Save progress and continue later');
        console.log('✅ Apps go LIVE immediately after upload - no approval needed!');
        console.log('🔐 Google Sign-In enabled!');
        console.log('🎨 Persistent theme saved in localStorage');
        console.log('🖼️ Edit modal only uses file uploads for images (no URL fields)');
