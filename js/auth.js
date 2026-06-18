/* ===== 508宿舍 登录/注册模块 ===== */

const API = '/api';

async function readApiResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(`接口返回了非 JSON 内容（HTTP ${res.status}）`);
    }
    return res.json();
}

function connectionErrorMessage(err) {
    if (location.protocol === 'file:') {
        return '请通过网站地址访问，不要直接双击打开 index.html';
    }
    return `请求失败：${err.message || '请检查网络后重试'}`;
}

// 状态
let currentUser = null;
let currentToken = null;

// 从 localStorage 恢复登录态
(function restoreAuth() {
    const saved = localStorage.getItem('dorm508_token');
    if (!saved) return;
    const data = JSON.parse(saved);
    currentToken = data.token;
    fetch(`${API}/me`, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            currentUser = data.user;
            updateUI();
        } else {
            logout();
        }
    })
    .catch(() => { /* 后端未启动，忽略 */ });
})();

// UI 元素
const btnLogin = document.getElementById('btnLogin');
const userMenu = document.getElementById('userMenu');
const displayName = document.getElementById('displayName');
const btnLogout = document.getElementById('btnLogout');
const loginModal = document.getElementById('loginModal');
const modalClose = document.getElementById('modalClose');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const regError = document.getElementById('regError');
const modalTabs = document.querySelectorAll('.modal-tab');

// 切换登录/注册表单
modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        modalTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        loginForm.classList.toggle('hidden', target !== 'login');
        registerForm.classList.toggle('hidden', target !== 'register');
        loginError.classList.add('hidden');
        regError.classList.add('hidden');
    });
});

// 打开弹窗
btnLogin.addEventListener('click', () => {
    loginModal.classList.remove('hidden');
});
modalClose.addEventListener('click', () => {
    loginModal.classList.add('hidden');
});
loginModal.addEventListener('click', (e) => {
    if (e.target === loginModal) loginModal.classList.add('hidden');
});

// 退出
btnLogout.addEventListener('click', logout);

function logout() {
    currentUser = null;
    currentToken = null;
    localStorage.removeItem('dorm508_token');
    updateUI();
}

// 登录
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;
    loginError.classList.add('hidden');

    try {
        const res = await fetch(`${API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });
        const data = await readApiResponse(res);
        if (data.ok) {
            currentUser = data.user;
            currentToken = data.token;
            localStorage.setItem('dorm508_token', JSON.stringify({ token: data.token }));
            updateUI();
            loginModal.classList.add('hidden');
            document.getElementById('loginPassword').value = '';
        } else {
            loginError.textContent = data.error;
            loginError.classList.remove('hidden');
        }
    } catch (err) {
        loginError.textContent = connectionErrorMessage(err);
        loginError.classList.remove('hidden');
    }
});

// 注册
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;
    regError.classList.add('hidden');

    if (password !== password2) {
        regError.textContent = '两次密码不一致';
        regError.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch(`${API}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await readApiResponse(res);
        if (data.ok) {
            currentUser = data.user;
            currentToken = data.token;
            localStorage.setItem('dorm508_token', JSON.stringify({ token: data.token }));
            updateUI();
            loginModal.classList.add('hidden');
            document.getElementById('regUsername').value = '';
            document.getElementById('regEmail').value = '';
            document.getElementById('regPassword').value = '';
            document.getElementById('regPassword2').value = '';
        } else {
            regError.textContent = data.error;
            regError.classList.remove('hidden');
        }
    } catch (err) {
        regError.textContent = connectionErrorMessage(err);
        regError.classList.remove('hidden');
    }
});

// 更新 UI
function updateUI() {
    if (currentUser) {
        btnLogin.classList.add('hidden');
        userMenu.classList.remove('hidden');
        displayName.textContent = `👤 ${currentUser.username}`;
    } else {
        btnLogin.classList.remove('hidden');
        userMenu.classList.add('hidden');
        displayName.textContent = '';
    }
    window.dispatchEvent(new CustomEvent('authchange', {
        detail: { user: currentUser }
    }));
}
