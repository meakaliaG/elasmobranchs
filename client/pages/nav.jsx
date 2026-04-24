/**
 * nav.jsx — Retractable Nav
 *
 * Fades the nav out after 2.8 s of inactivity.
 * Uses DOMContentLoaded (not window.onload) so it doesn't
 * overwrite viewer.jsx's window.onload handler.
 */

const initNav = () => {
    const nav = document.getElementById('siteNav');
    if (!nav) return;

    let hideTimer = null;

    const showNav = () => {
        nav.classList.remove('nav-hidden');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => nav.classList.add('nav-hidden'), 2800);
    };

    document.addEventListener('mousemove',  showNav, { passive: true });
    document.addEventListener('touchstart', showNav, { passive: true });

    showNav();
};

window.addEventListener('DOMContentLoaded', initNav);
