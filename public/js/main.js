/* ===== 508宿舍 官方网站 脚本 ===== */

document.addEventListener('DOMContentLoaded', () => {
    // --- 导航栏滚动效果 ---
    const navbar = document.getElementById('navbar');
    const backToTop = document.getElementById('backToTop');

    function handleScroll() {
        const scrollY = window.scrollY;
        navbar.classList.toggle('scrolled', scrollY > 50);
        backToTop.classList.toggle('show', scrollY > 500);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });

    // --- 移动端菜单 ---
    const mobileToggle = document.getElementById('mobileToggle');
    const navLinks = document.querySelector('.nav-links');

    mobileToggle.addEventListener('click', () => {
        mobileToggle.classList.toggle('active');
        navLinks.classList.toggle('open');
    });

    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mobileToggle.classList.remove('active');
            navLinks.classList.remove('open');
        });
    });

    // --- 回到顶部 ---
    backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // --- 首页动态统计 ---
    const startDate = Date.UTC(2023, 8, 13);
    const today = new Date();
    const todayDate = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const daysTogether = Math.max(0, Math.floor((todayDate - startDate) / 86400000));
    document.getElementById('daysTogether').dataset.target = String(daysTogether);

    // 使用中国时区的日期作为种子：所有访客当天看到同一数值，每天更新一次。
    const chinaDateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(today);
    let dailySeed = 0;
    for (const char of chinaDateKey) {
        dailySeed = (dailySeed * 31 + char.charCodeAt(0)) >>> 0;
    }
    const happinessIndex = 500 + (dailySeed % 501);
    document.getElementById('happinessIndex').dataset.target = String(happinessIndex);

    // --- 数字滚动动画 ---
    const statNums = document.querySelectorAll('.stat-num');
    let statsAnimated = false;

    function animateStats() {
        if (statsAnimated) return;
        const hero = document.querySelector('.hero');
        if (!hero) return;
        const rect = hero.getBoundingClientRect();
        if (rect.bottom < 50) return;

        statsAnimated = true;
        statNums.forEach(el => {
            const raw = el.dataset.target;
            if (!/^\d+$/.test(raw)) {
                el.textContent = raw;
                return;
            }
            const target = parseInt(raw, 10);
            const suffix = el.dataset.suffix || '';
            const duration = 1500;
            const start = performance.now();
            function update(now) {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                el.textContent = `${Math.floor(eased * target)}${suffix}`;
                if (progress < 1) requestAnimationFrame(update);
                else el.textContent = `${target}${suffix}`;
            }
            requestAnimationFrame(update);
        });
    }
    window.addEventListener('scroll', animateStats, { passive: true });
    animateStats();

    // --- 图片灯箱 ---
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = `
        <button class="lightbox-close" aria-label="关闭">&times;</button>
        <img src="" alt="">
    `;
    document.body.appendChild(lightbox);

    const lightboxImg = lightbox.querySelector('img');
    const lightboxClose = lightbox.querySelector('.lightbox-close');

    function openLightbox(src) {
        lightboxImg.src = src;
        lightbox.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(() => { lightboxImg.src = ''; }, 300);
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    document.querySelectorAll('.photowall-item img, .travel-img img').forEach(img => {
        img.addEventListener('click', () => openLightbox(img.src));
    });

    // --- 管理员照片墙 ---
    const photowallGrid = document.querySelector('.photowall-grid');
    const photoAdminPanel = document.getElementById('photoAdminPanel');
    const photoUploadInput = document.getElementById('photoUploadInput');
    const photoUploadStatus = document.getElementById('photoUploadStatus');

    function addPhotoToWall(photo, prepend = true) {
        const item = document.createElement('div');
        item.className = 'photowall-item uploaded-photo';
        item.dataset.photoId = photo.id;
        const img = document.createElement('img');
        img.src = photo.url;
        img.alt = photo.filename || '管理员上传的照片';
        img.loading = 'lazy';
        img.addEventListener('click', () => openLightbox(img.src));
        item.appendChild(img);
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'photo-delete hidden';
        deleteButton.setAttribute('aria-label', `删除${img.alt}`);
        deleteButton.textContent = '删除';
        item.appendChild(deleteButton);
        deleteButton.classList.toggle('hidden', !currentAdminToken);
        if (prepend) photowallGrid.prepend(item);
        else photowallGrid.appendChild(item);
    }

    async function loadUploadedPhotos() {
        try {
            const res = await fetch('/api/photos');
            const data = await res.json();
            if (data.ok) data.photos.forEach(photo => addPhotoToWall(photo, true));
        } catch {
            // 上传照片接口暂不可用时保留内置照片。
        }
    }

    function compressPhoto(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);
            img.onload = () => {
                const maxSide = 1800;
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const context = canvas.getContext('2d');
                context.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(objectUrl);
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('图片处理失败'));
                        return;
                    }
                    resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                        type: 'image/jpeg'
                    }));
                }, 'image/jpeg', 0.82);
            };
            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('无法读取图片'));
            };
            img.src = objectUrl;
        });
    }

    window.addEventListener('authchange', (event) => {
        photoAdminPanel.classList.toggle('hidden', !event.detail.adminToken);
        photowallGrid.querySelectorAll('.photo-delete').forEach(button => {
            button.classList.toggle('hidden', !event.detail.adminToken);
        });
    });
    photoAdminPanel.classList.toggle('hidden', !currentAdminToken);

    photoUploadInput.addEventListener('change', async () => {
        const original = photoUploadInput.files?.[0];
        if (!original || !currentAdminToken) return;

        photoUploadStatus.className = 'photo-upload-status';
        photoUploadStatus.textContent = '正在压缩并上传…';
        photoUploadInput.disabled = true;
        try {
            const compressed = await compressPhoto(original);
            if (compressed.size > 1_500_000) {
                throw new Error('图片压缩后仍超过 1.5MB，请换一张较小的图片');
            }
            const form = new FormData();
            form.append('photo', compressed);
            const res = await fetch('/api/photos', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${currentAdminToken}` },
                body: form
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || '上传失败');
            addPhotoToWall(data.photo, true);
            photoUploadStatus.classList.add('success');
            photoUploadStatus.textContent = '上传成功！';
        } catch (err) {
            photoUploadStatus.classList.add('error');
            photoUploadStatus.textContent = err.message || '上传失败';
        } finally {
            photoUploadInput.disabled = false;
            photoUploadInput.value = '';
        }
    });

    photowallGrid.addEventListener('click', async (event) => {
        const button = event.target.closest('.photo-delete');
        if (!button || !currentAdminToken) return;
        const item = button.closest('.uploaded-photo');
        const photoId = item?.dataset.photoId;
        if (!photoId || !confirm('确定永久删除这张照片吗？')) return;

        button.disabled = true;
        button.textContent = '删除中…';
        try {
            const res = await fetch(`/api/photos/${photoId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${currentAdminToken}` }
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error || '删除失败');
            item.remove();
            closeLightbox();
            photoUploadStatus.className = 'photo-upload-status success';
            photoUploadStatus.textContent = '照片已删除';
        } catch (err) {
            button.disabled = false;
            button.textContent = '删除';
            photoUploadStatus.className = 'photo-upload-status error';
            photoUploadStatus.textContent = err.message || '删除失败';
        }
    });
    loadUploadedPhotos();

    // --- 隐藏成员彩蛋 ---
    const zhaoCard = document.getElementById('zhaoCard');
    const easterOverlay = document.getElementById('easterOverlay');
    const easterClose = document.getElementById('easterClose');
    const easterForm = document.getElementById('easterForm');
    const easterPassword = document.getElementById('easterPassword');
    const easterError = document.getElementById('easterError');
    const easterLock = document.getElementById('easterLock');
    const easterReveal = document.getElementById('easterReveal');

    function openEasterEgg() {
        easterOverlay.classList.remove('hidden');
        easterLock.classList.remove('hidden');
        easterReveal.classList.add('hidden');
        easterError.classList.add('hidden');
        easterPassword.value = '';
        document.body.style.overflow = 'hidden';
        setTimeout(() => easterPassword.focus(), 50);
    }

    function closeEasterEgg() {
        easterOverlay.classList.add('hidden');
        document.body.style.overflow = '';
        zhaoCard.focus();
    }

    zhaoCard.addEventListener('click', openEasterEgg);
    zhaoCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEasterEgg();
        }
    });
    easterClose.addEventListener('click', closeEasterEgg);
    easterOverlay.addEventListener('click', (e) => {
        if (e.target === easterOverlay) closeEasterEgg();
    });
    easterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (easterPassword.value === 'dkw0607') {
            easterLock.classList.add('hidden');
            easterReveal.classList.remove('hidden');
        } else {
            easterError.classList.remove('hidden');
            easterPassword.select();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLightbox();
            if (!easterOverlay.classList.contains('hidden')) closeEasterEgg();
        }
    });

    // ==================== 留言板（数据库版） ====================
    const API = '/api';
    const guestbookForm = document.getElementById('guestbookForm');
    const guestbookList = document.getElementById('guestbookList');

    function getToken() {
        const saved = localStorage.getItem('dorm508_token');
        if (!saved) return null;
        try { return JSON.parse(saved).token; } catch { return null; }
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatTime(timeStr) {
        if (!timeStr) return '';
        return timeStr.replace(' ', ' ').slice(0, 16);
    }

    function renderMessage(msg, prepend = false) {
        const avatars = ['🐱', '🐶', '🐼', '🐨', '🦊', '🐰', '🐸', '🐵'];
        const avatar = avatars[msg.id ? msg.id % avatars.length : Math.floor(Math.random() * avatars.length)];
        const canDelete = currentUser && Number(msg.user_id) === Number(currentUser.id);

        const item = document.createElement('div');
        item.className = 'guestbook-item';
        item.dataset.messageId = msg.id;
        item.innerHTML = `
            <div class="guest-avatar">${avatar}</div>
            <div class="guest-content">
                <div class="guest-meta">
                    <span class="guest-name">${escapeHTML(msg.username)}</span>
                    ${canDelete ? '<button type="button" class="guest-delete">删除</button>' : ''}
                </div>
                <p>${escapeHTML(msg.content)}</p>
                <span class="guest-time">${formatTime(msg.created_at)}</span>
            </div>
        `;

        if (prepend && guestbookList.firstChild) {
            guestbookList.insertBefore(item, guestbookList.firstChild);
        } else {
            guestbookList.appendChild(item);
        }
    }

    // 从数据库加载留言
    async function loadMessages() {
        try {
            const res = await fetch(`${API}/messages`);
            const data = await res.json();
            if (data.ok) {
                guestbookList.innerHTML = '';
                data.messages.forEach(msg => renderMessage(msg));
            }
        } catch (err) {
            // 后端暂时不可用时保持当前内容。
        }
    }

    // 发表留言
    guestbookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = document.getElementById('guestMessage').value.trim();
        if (!content) return;

        const token = getToken();
        if (!token) {
            alert('请先登录再留言！');
            return;
        }

        try {
            const res = await fetch(`${API}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ content })
            });
            const data = await res.json();
            if (data.ok) {
                renderMessage(data.message, true);
                document.getElementById('guestMessage').value = '';
            } else {
                alert(data.error || '留言失败');
            }
        } catch (err) {
            alert(location.protocol === 'file:'
                ? '请通过网站地址访问，不要直接双击打开 index.html'
                : `留言请求失败：${err.message || '请检查网络后重试'}`);
        }
    });

    guestbookList.addEventListener('click', async (e) => {
        const button = e.target.closest('.guest-delete');
        if (!button) return;

        const item = button.closest('.guestbook-item');
        const messageId = item?.dataset.messageId;
        const token = getToken();
        if (!messageId || !token || !confirm('确定删除这条留言吗？')) return;

        button.disabled = true;
        try {
            const res = await fetch(`${API}/messages/${messageId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.ok) {
                item.remove();
            } else {
                button.disabled = false;
                alert(data.error || '删除失败');
            }
        } catch {
            button.disabled = false;
            alert('无法连接服务器，请稍后重试');
        }
    });

    window.addEventListener('authchange', loadMessages);
    loadMessages();
});
