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
            const duration = 1500;
            const start = performance.now();
            function update(now) {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                el.textContent = Math.floor(eased * target);
                if (progress < 1) requestAnimationFrame(update);
                else el.textContent = target;
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
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    document.querySelectorAll('.photowall-item img, .travel-img img').forEach(img => {
        img.addEventListener('click', () => openLightbox(img.src));
    });

    // --- 滚动渐入动画 ---
    const revealEls = document.querySelectorAll('.member-card, .travel-card, .photowall-item, .guestbook-item');

    function revealOnScroll() {
        const windowHeight = window.innerHeight;
        revealEls.forEach(el => {
            const top = el.getBoundingClientRect().top;
            if (top < windowHeight - 60) {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }
        });
    }

    revealEls.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });
    window.addEventListener('scroll', revealOnScroll, { passive: true });
    revealOnScroll();

    // ==================== 留言板（数据库版） ====================
    const API = 'http://localhost:3000/api';
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

        const item = document.createElement('div');
        item.className = 'guestbook-item';
        item.innerHTML = `
            <div class="guest-avatar">${avatar}</div>
            <div class="guest-content">
                <span class="guest-name">${escapeHTML(msg.username)}</span>
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
            if (data.ok && data.messages.length > 0) {
                // 清空默认占位留言
                guestbookList.innerHTML = '';
                data.messages.forEach(msg => renderMessage(msg));
            }
        } catch (err) {
            // 后端未启动，保留 HTML 中的默认留言
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
                // 清除默认占位（首次留言时）
                const defaultItems = guestbookList.querySelectorAll('.guestbook-item');
                if (defaultItems.length <= 2 &&
                    defaultItems[0]?.querySelector('.guest-name')?.textContent === '隔壁509') {
                    guestbookList.innerHTML = '';
                }
                renderMessage(data.message, true);
                document.getElementById('guestMessage').value = '';
            } else {
                alert(data.error || '留言失败');
            }
        } catch (err) {
            alert('无法连接服务器，请确保后端已启动');
        }
    });

    loadMessages();
});
