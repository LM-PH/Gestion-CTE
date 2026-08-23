/**
 * CTE Inteligente - PWA App Core
 */

window.ENV = {
    // Cuando subas tu backend a Render, cambia esta URL por la tuya. 
    // Ejemplo: 'https://mi-backend-cte.onrender.com'
    API_URL: 'https://gestion-cte.onrender.com'
};

class App {
    constructor() {
        this.currentView = 'view-login';
        this.apiBaseUrl = window.ENV.API_URL + '/api';
        
        // Exponer globalmente para módulos
        window.app = this;
        
        document.addEventListener('DOMContentLoaded', () => {
            if (window.authModule) {
                window.authModule.init();
            }
            this.init();
            this.checkAuthAndRoute();
        });
    }

    init() {
        this.setupNavigation();
        this.registerServiceWorker();
        this.createLoadingUI();
    }
    
    checkAuthAndRoute() {
        if (!window.authModule) return;
        
        if (!window.authModule.isLoggedIn()) {
            this.navigate('view-login');
            document.getElementById('side-nav').style.display = 'none';
            document.querySelector('.app-header').style.display = 'none';
        } else {
            document.getElementById('side-nav').style.display = 'flex';
            document.querySelector('.app-header').style.display = 'flex';
            
            if (window.authModule.isAdmin()) {
                this.navigate('view-admin');
                this.loadAdminData();
            } else {
                if (this.currentView === 'view-login' || this.currentView === 'view-admin') {
                    this.navigate('view-inicio');
                }
            }
            window.authModule.updateUI();
        }
    }
    
    async loadAdminData() {
        if (!window.authModule || !window.authModule.isAdmin()) return;
        const users = await window.authModule.fetchUsersForAdmin();
        const tbody = document.getElementById('admin-users-table-body');
        if (tbody) {
            tbody.innerHTML = users.map(u => `
                <tr>
                    <td style="padding:1rem; border-bottom:1px solid #e2e8f0;">${u.email}</td>
                    <td style="padding:1rem; border-bottom:1px solid #e2e8f0;">${u.name || '-'}</td>
                    <td style="padding:1rem; border-bottom:1px solid #e2e8f0;">${u.credits || 0}</td>
                    <td style="padding:1rem; border-bottom:1px solid #e2e8f0;">${new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
            `).join('');
        }
    }

    createLoadingUI() {
        const overlay = document.createElement('div');
        overlay.id = 'app-loading-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.8); display:none; justify-content:center; align-items:center; z-index:9999; flex-direction:column;';
        overlay.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin fa-3x" style="color:var(--primary); margin-bottom:1rem;"></i>
            <h3 id="app-loading-text">Cargando...</h3>
        `;
        document.body.appendChild(overlay);
    }

    showLoading(text = "Cargando...") {
        const overlay = document.getElementById('app-loading-overlay');
        const textEl = document.getElementById('app-loading-text');
        if (overlay && textEl) {
            textEl.innerText = text;
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        const overlay = document.getElementById('app-loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    setupNavigation() {
        const links = document.querySelectorAll('.nav-link');
        const menuToggle = document.getElementById('menu-btn');
        const sideNav = document.getElementById('side-nav');
        const navOverlay = document.getElementById('nav-overlay');

        // Navigation click handlers
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('data-target');
                this.navigate(targetId);
                
                // Close mobile menu if open
                if (window.innerWidth <= 768 && sideNav && navOverlay) {
                    sideNav.classList.remove('open');
                    navOverlay.classList.remove('show');
                }
            });
        });

        // Mobile menu toggle
        if (menuToggle && sideNav && navOverlay) {
            menuToggle.addEventListener('click', () => {
                sideNav.classList.toggle('open');
                navOverlay.classList.toggle('show');
            });

            navOverlay.addEventListener('click', () => {
                sideNav.classList.remove('open');
                navOverlay.classList.remove('show');
            });
        }
    }

    navigate(viewId) {
        // Update active class on links
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('data-target') === viewId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Update active class on views
        document.querySelectorAll('.view').forEach(view => {
            if (view.id === viewId) {
                view.classList.add('active');
            } else {
                view.classList.remove('active');
            }
        });

        this.currentView = viewId;
        window.scrollTo(0, 0);
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(registration => {
                        console.log('ServiceWorker registrado con éxito:', registration.scope);
                    })
                    .catch(error => {
                        console.log('Fallo el registro del ServiceWorker:', error);
                    });
            });
        }
    }
}

// La instancia se inicializa y se guarda en window.app dentro de su constructor
new App();
