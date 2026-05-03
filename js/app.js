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
        this.currentView = 'view-inicio';
        this.init();
    }

    init() {
        this.setupNavigation();
        this.registerServiceWorker();
    }

    setupNavigation() {
        const links = document.querySelectorAll('.nav-link');
        const views = document.querySelectorAll('.view');
        const menuToggle = document.getElementById('menu-toggle');
        const sideNav = document.getElementById('side-nav');
        const navOverlay = document.getElementById('nav-overlay');

        // Navigation click handlers
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = link.getAttribute('data-target');
                this.navigate(targetId);
                
                // Close mobile menu if open
                if (window.innerWidth <= 768) {
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

// Inicializar la app
const app = new App();
