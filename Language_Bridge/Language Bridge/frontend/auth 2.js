// ==================== AUTHENTICATION MODULE ====================

// Toast notification function
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
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Login handler
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            
            try {
                const response = await fetch('http://localhost:5000/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    localStorage.setItem('currentUser', JSON.stringify(data.user));
                    showToast('✨ Welcome back!', 'success');
                    setTimeout(() => {
                        window.location.href = 'chat.html';
                    }, 1500);
                } else {
                    showToast(data.error || 'Login failed', 'error');
                }
            } catch (error) {
                // Simulate successful login for demo
                const mockUser = {
                    id: 1,
                    username: username || 'John Doe',
                    language: 'en'
                };
                localStorage.setItem('currentUser', JSON.stringify(mockUser));
                showToast('✨ Welcome back! (Demo Mode)', 'success');
                setTimeout(() => {
                    window.location.href = 'chat.html';
                }, 1500);
            }
        });
    }
    
    // Register handler
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('register-username').value;
            const password = document.getElementById('register-password').value;
            const confirm = document.getElementById('register-confirm').value;
            const language = document.getElementById('register-language').value;
            
            if (password !== confirm) {
                showToast('Passwords do not match', 'error');
                return;
            }
            
            try {
                const response = await fetch('http://localhost:5000/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, language })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showToast('✅ Account created! Please login', 'success');
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 1500);
                } else {
                    showToast(data.error || 'Registration failed', 'error');
                }
            } catch (error) {
                // Simulate successful registration for demo
                showToast('✅ Account created! Please login (Demo Mode)', 'success');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1500);
            }
        });
    }
});

// Export for use in other files
window.showToast = showToast;