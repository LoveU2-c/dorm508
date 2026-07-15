const API = '/api';

const adminToken = sessionStorage.getItem('dorm508_admin_token');
const savedAuth = localStorage.getItem('dorm508_token');
let normalToken = null;
let currentUser = null;
let users = [];

try {
    normalToken = savedAuth ? JSON.parse(savedAuth).token : null;
} catch {
    normalToken = null;
}

const adminGate = document.getElementById('adminGate');
const adminPanel = document.getElementById('adminPanel');
const adminGateError = document.getElementById('adminGateError');
const adminPageBadge = document.getElementById('adminPageBadge');
const adminLogout = document.getElementById('adminLogout');
const retryAdmin = document.getElementById('retryAdmin');
const refreshUsers = document.getElementById('refreshUsers');
const userSearch = document.getElementById('userSearch');
const usersTableBody = document.getElementById('usersTableBody');
const adminSummary = document.getElementById('adminSummary');

function showError(message) {
    adminGateError.textContent = message;
    adminGateError.classList.remove('hidden');
}

function formatTime(time) {
    return time ? time.replace('T', ' ').slice(0, 16) : '-';
}

function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

async function readJson(res) {
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
    }
    return data;
}

async function verifyAccess() {
    if (!normalToken || !adminToken) {
        showError('当前浏览器没有检测到登录态或管理员权限。');
        return;
    }

    try {
        const [meData] = await Promise.all([
            fetch(`${API}/me`, { headers: { 'Authorization': `Bearer ${normalToken}` } }).then(readJson),
            fetch(`${API}/admin/me`, { headers: { 'Authorization': `Bearer ${adminToken}` } }).then(readJson),
        ]);
        currentUser = meData.user;
        adminGate.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        adminPageBadge.classList.remove('hidden');
        adminLogout.classList.remove('hidden');
        loadUsers();
    } catch (err) {
        sessionStorage.removeItem('dorm508_admin_token');
        showError(err.message || '管理员权限已过期，请回首页重新登录。');
    }
}

async function loadUsers() {
    adminSummary.textContent = '正在加载账号…';
    usersTableBody.innerHTML = '';
    try {
        const data = await fetch(`${API}/admin/users`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        }).then(readJson);
        users = data.users || [];
        renderUsers();
    } catch (err) {
        adminSummary.textContent = err.message || '账号加载失败';
    }
}

function renderUsers() {
    const keyword = userSearch.value.trim().toLowerCase();
    const filtered = users.filter((user) => {
        return !keyword
            || String(user.username || '').toLowerCase().includes(keyword)
            || String(user.email || '').toLowerCase().includes(keyword)
            || String(user.id).includes(keyword);
    });

    adminSummary.textContent = `共 ${users.length} 个账号，当前显示 ${filtered.length} 个`;
    usersTableBody.innerHTML = filtered.map((user) => {
        const isSelf = currentUser && Number(user.id) === Number(currentUser.id);
        return `
            <tr data-user-id="${user.id}">
                <td>${user.id}</td>
                <td>${escapeHTML(user.username)}${isSelf ? '<span class="self-mark">当前账号</span>' : ''}</td>
                <td>${escapeHTML(user.email || '-')}</td>
                <td>${user.message_count}</td>
                <td>${user.photo_count}</td>
                <td>${formatTime(user.created_at)}</td>
                <td>
                    <button class="admin-delete-user" type="button" ${isSelf ? 'disabled' : ''}>
                        ${isSelf ? '不可删除' : '删除'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (!filtered.length) {
        usersTableBody.innerHTML = '<tr><td colspan="7" class="empty-cell">没有匹配的账号</td></tr>';
    }
}

async function deleteUser(row) {
    const userId = row.dataset.userId;
    const user = users.find((item) => Number(item.id) === Number(userId));
    if (!user) return;
    const message = `确定删除账号「${user.username}」吗？\n该账号发布的留言和上传照片也会一起删除。`;
    if (!confirm(message)) return;

    const button = row.querySelector('.admin-delete-user');
    button.disabled = true;
    button.textContent = '删除中…';
    try {
        await fetch(`${API}/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        }).then(readJson);
        users = users.filter((item) => Number(item.id) !== Number(userId));
        renderUsers();
    } catch (err) {
        button.disabled = false;
        button.textContent = '删除';
        alert(err.message || '删除失败');
    }
}

retryAdmin.addEventListener('click', () => location.reload());
refreshUsers.addEventListener('click', loadUsers);
userSearch.addEventListener('input', renderUsers);
usersTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('.admin-delete-user');
    if (!button || button.disabled) return;
    const row = button.closest('tr');
    if (row) deleteUser(row);
});
adminLogout.addEventListener('click', () => {
    localStorage.removeItem('dorm508_token');
    sessionStorage.removeItem('dorm508_admin_token');
    location.href = '/';
});

verifyAccess();
