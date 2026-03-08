// ==================== AUTHENTICATION MODULE ====================

const USERNAME_MAP_KEY = 'lb_username_map';
let authFlowLock = false;
let loginInProgress = false;
let registerInProgress = false;

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;

    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'warning') icon = 'exclamation-triangle';

    toast.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(value) {
    return (value || 'user')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/(^\.|\.$)/g, '') || 'user';
}

function sanitizeUser(user) {
    const username = (user?.username || 'Guest User').trim();
    const safeUsername = username || 'Guest User';
    const safeEmail = user?.email || `${slugify(safeUsername)}@linguabridge.app`;

    return {
        id: user?.id || Date.now(),
        username: safeUsername,
        email: safeEmail,
        language: user?.language || 'en',
        profilePhoto: user?.profilePhoto || ''
    };
}

function getStoredCurrentUser() {
    try {
        const raw = localStorage.getItem('currentUser');
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function getFirebase() {
    return window.lbFirebase || null;
}

function loadUsernameMap() {
    try {
        const raw = localStorage.getItem(USERNAME_MAP_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        return {};
    }
}

function saveUsernameMap(map) {
    localStorage.setItem(USERNAME_MAP_KEY, JSON.stringify(map));
}

function mapUsernameToEmail(username, email) {
    if (!username || !email) return;
    const map = loadUsernameMap();
    map[slugify(username)] = email.toLowerCase();
    saveUsernameMap(map);
}

async function resolveIdentityToEmail(identity) {
    const trimmed = (identity || '').trim();
    if (!trimmed) return { email: '', lookupUnavailable: false };

    if (isValidEmail(trimmed)) {
        return { email: trimmed.toLowerCase(), lookupUnavailable: false };
    }

    const map = loadUsernameMap();
    const localEmail = map[slugify(trimmed)] || '';
    if (localEmail) return { email: localEmail, lookupUnavailable: false };

    const fb = getFirebase();
    if (!fb?.getUsernameRecord) {
        return { email: '', lookupUnavailable: true };
    }

    try {
        const record = await fb.getUsernameRecord(slugify(trimmed));
        if (record?.email) {
            mapUsernameToEmail(trimmed, record.email);
            return { email: record.email, lookupUnavailable: false };
        }
    } catch (error) {
        console.warn('Username lookup failed:', error?.message || error);
        return { email: '', lookupUnavailable: true };
    }

    return { email: '', lookupUnavailable: false };
}

function toLocalUser(firebaseUser, overrides = {}) {
    const storedUser = getStoredCurrentUser();
    const inferredUsername = overrides.username
        || firebaseUser?.displayName
        || storedUser?.username
        || (firebaseUser?.email ? firebaseUser.email.split('@')[0] : 'User');

    return sanitizeUser({
        id: firebaseUser?.uid,
        username: inferredUsername,
        email: firebaseUser?.email || overrides.email,
        language: overrides.language || storedUser?.language || 'en',
        profilePhoto: firebaseUser?.photoURL || overrides.profilePhoto || storedUser?.profilePhoto || ''
    });
}

function persistLocalUser(user) {
    const safeUser = sanitizeUser(user);
    localStorage.setItem('currentUser', JSON.stringify(safeUser));
    window.currentUser = safeUser;
    mapUsernameToEmail(safeUser.username, safeUser.email);
    return safeUser;
}

function saveAndRedirect(user, successMessage, redirectTo) {
    persistLocalUser(user);
    showToast(successMessage, 'success');
    setTimeout(() => {
        window.location.href = redirectTo;
    }, 250);
}

function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;

    if (isLoading) {
        if (!button.dataset.originalHtml) {
            button.dataset.originalHtml = button.innerHTML;
        }
        button.disabled = true;
        button.classList.add('is-loading');
        button.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;
        return;
    }

    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
    }
}

function getAuthErrorMessage(code) {
    const fallback = 'Authentication failed. Please try again.';
    const authMessages = {
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/invalid-email': 'Invalid email format.',
        'auth/weak-password': 'Password should be at least 6 characters.',
        'auth/operation-not-allowed': 'Email/password sign-up is disabled in Firebase Auth settings.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
        'auth/internal-error': 'Server issue occurred. Please try again in a moment.',
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
        'auth/network-request-failed': 'Network error. Check your internet connection.',
        'permission-denied': 'Database permission issue. Please check Firebase Firestore rules.',
        'unavailable': 'Service is temporarily unavailable. Please try again in a moment.',
        'lb/username-already-used': 'This username is already used by another user.',
        'lb/invalid-username': 'Invalid username. Please choose another one.'
    };

    return authMessages[code] || fallback;
}

function setupFirebaseSessionSync(isAuthPage) {
    const fb = getFirebase();
    if (!fb) return;
    const isChatPage = window.location.pathname.endsWith('/chat.html') || window.location.pathname.endsWith('chat.html');

    fb.onAuthStateChanged(fb.auth, (firebaseUser) => {
        if (firebaseUser) {
            if (!(isAuthPage && authFlowLock)) {
                persistLocalUser(toLocalUser(firebaseUser));
            }

            if (isAuthPage && !authFlowLock && !registerInProgress) {
                window.location.href = 'chat.html';
            }
        } else if (!isAuthPage) {
            localStorage.removeItem('currentUser');
            window.currentUser = null;
            if (isChatPage) {
                window.location.href = 'index.html';
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const isAuthPage = Boolean(loginForm || registerForm);

    setupFirebaseSessionSync(isAuthPage);

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginInProgress || authFlowLock) return;

            const identity = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;
            const loginBtn = loginForm.querySelector('button[type="submit"]');
            if (!identity || !password) {
                showToast('Please enter email/username and password.', 'warning');
                return;
            }

            loginInProgress = true;
            authFlowLock = true;
            setButtonLoading(loginBtn, true, 'Signing In...');

            const resolution = await resolveIdentityToEmail(identity);
            const email = resolution.email;

            if (!email) {
                if (!identity.includes('@') && resolution.lookupUnavailable) {
                    showToast('Username lookup is unavailable right now. Please log in with email.', 'warning');
                } else {
                    showToast('Username not found. Use registered email or choose another username.', 'warning');
                }
                setButtonLoading(loginBtn, false);
                loginInProgress = false;
                authFlowLock = false;
                return;
            }

            const fb = getFirebase();
            if (!fb) {
                showToast('Firebase is not initialized. Check script loading.', 'error');
                setButtonLoading(loginBtn, false);
                loginInProgress = false;
                authFlowLock = false;
                return;
            }

            try {
                const credential = await fb.signInWithEmailAndPassword(fb.auth, email, password);
                const user = toLocalUser(credential.user);
                saveAndRedirect(user, 'Welcome back!', 'chat.html');
            } catch (error) {
                showToast(getAuthErrorMessage(error?.code), 'error');
            } finally {
                setButtonLoading(loginBtn, false);
                loginInProgress = false;
                authFlowLock = false;
            }
        });

        document.getElementById('forgot-password-link')?.addEventListener('click', async () => {
            const identity = window.prompt('Enter your email (or mapped username) to reset password:')?.trim();
            if (!identity) return;

            const resolution = await resolveIdentityToEmail(identity);
            const email = resolution.email;
            if (!email) {
                if (!identity.includes('@') && resolution.lookupUnavailable) {
                    showToast('Username lookup is unavailable right now. Please use email for reset.', 'warning');
                } else {
                    showToast('Please enter a valid registered email address.', 'error');
                }
                return;
            }

            const fb = getFirebase();
            if (!fb) {
                showToast('Firebase is not initialized. Check script loading.', 'error');
                return;
            }

            try {
                await fb.sendPasswordResetEmail(fb.auth, email);
                showToast(`Password reset link sent to ${email}`, 'success');
            } catch (error) {
                showToast(getAuthErrorMessage(error?.code), 'error');
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (registerInProgress || authFlowLock) return;

            const username = document.getElementById('register-username').value.trim();
            const email = document.getElementById('register-email').value.trim().toLowerCase();
            const password = document.getElementById('register-password').value;
            const confirm = document.getElementById('register-confirm').value;
            const language = document.getElementById('register-language').value;
            const registerBtn = registerForm.querySelector('button[type="submit"]');

            if (!username) {
                showToast('Username is required', 'error');
                return;
            }

            if (!isValidEmail(email)) {
                showToast('Enter a valid email address', 'error');
                return;
            }

            if (password !== confirm) {
                showToast('Passwords do not match', 'error');
                return;
            }

            if (password.length < 6) {
                showToast('Password must be at least 6 characters', 'error');
                return;
            }

            const fb = getFirebase();
            if (!fb) {
                showToast('Firebase is not initialized. Check script loading.', 'error');
                return;
            }

            const usernameKey = slugify(username);
            if (!usernameKey || usernameKey.length < 3) {
                showToast('Username must be at least 3 characters', 'error');
                return;
            }

            try {
                registerInProgress = true;
                authFlowLock = true;
                setButtonLoading(registerBtn, true, 'Creating Account...');

                if (fb.fetchSignInMethodsForEmail) {
                    const methods = await fb.fetchSignInMethodsForEmail(fb.auth, email);
                    if (methods && methods.length) {
                        showToast('This email is already registered. Please sign in.', 'warning');
                        return;
                    }
                }

                const credential = await fb.createUserWithEmailAndPassword(fb.auth, email, password);
                mapUsernameToEmail(username, email);

                try {
                    await fb.updateProfile(credential.user, { displayName: username });
                } catch (profileUpdateError) {
                    console.warn('Profile displayName update failed:', profileUpdateError?.message || profileUpdateError);
                }

                Promise.resolve().then(async () => {
                    if (fb.reserveUsername) {
                        try {
                            await fb.reserveUsername(usernameKey, {
                                uid: credential.user.uid,
                                email,
                                username
                            });
                        } catch (reserveError) {
                            console.warn('Username registry reserve unavailable:', reserveError?.message || reserveError);
                        }
                    }
                    if (fb.saveUserProfile) {
                        try {
                            await fb.saveUserProfile(credential.user.uid, {
                                username,
                                usernameKey,
                                email,
                                language
                            });
                        } catch (profileError) {
                            console.warn('User profile save failed:', profileError?.message || profileError);
                        }
                    }
                });

                try {
                    await fb.signOut(fb.auth);
                } catch (signOutError) {
                    console.warn('Post-register sign out failed:', signOutError?.message || signOutError);
                }

                localStorage.removeItem('currentUser');
                window.currentUser = null;
                showToast('Account created successfully. Please sign in.', 'success');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 180);
                return;
            } catch (error) {
                showToast(getAuthErrorMessage(error?.code), 'error');
            } finally {
                setButtonLoading(registerBtn, false);
                registerInProgress = false;
                authFlowLock = false;
            }
        });
    }
});

window.showToast = showToast;
window.firebaseSignOut = async function firebaseSignOut() {
    const fb = getFirebase();
    if (!fb) return;
    await fb.signOut(fb.auth);
};
