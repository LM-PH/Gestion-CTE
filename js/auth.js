const authModule = {
    token: null,
    user: null,

    init() {
        this.token = localStorage.getItem('cte_token');
        const userStr = localStorage.getItem('cte_user');
        if (userStr) {
            try {
                this.user = JSON.parse(userStr);
            } catch (e) {
                console.error('Error parseando usuario:', e);
            }
        }
        
        // Configurar Google Identity Services
        window.handleGoogleCredentialResponse = this.handleGoogleCredentialResponse.bind(this);
    },

    isLoggedIn() {
        return !!this.token;
    },

    isAdmin() {
        return this.user && this.user.role === 'admin';
    },

    async handleGoogleCredentialResponse(response) {
        try {
            app.showLoading("Iniciando sesión...");
            const res = await fetch(`${app.apiBaseUrl}/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: response.credential })
            });
            const data = await res.json();
            
            if (data.success) {
                this.setSession(data.token, data.user);
                app.hideLoading();
                app.checkAuthAndRoute();
            } else {
                app.hideLoading();
                alert("Error al iniciar sesión: " + (data.error || 'Desconocido'));
            }
        } catch (error) {
            app.hideLoading();
            console.error("Error iniciando sesión:", error);
            alert("Error de conexión al iniciar sesión.");
        }
    },

    async loginAdmin(email, password) {
        try {
            app.showLoading("Validando administrador...");
            const res = await fetch(`${app.apiBaseUrl}/auth/admin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            
            if (data.success) {
                this.setSession(data.token, data.user);
                app.hideLoading();
                app.checkAuthAndRoute();
            } else {
                app.hideLoading();
                alert("Error: " + (data.error || 'Credenciales inválidas'));
            }
        } catch (error) {
            app.hideLoading();
            console.error("Error iniciando sesión admin:", error);
            alert("Error de conexión al iniciar sesión.");
        }
    },

    setSession(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('cte_token', token);
        localStorage.setItem('cte_user', JSON.stringify(user));
        this.updateUI();
    },

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('cte_token');
        localStorage.removeItem('cte_user');
        
        // Limpiar datos locales para que no se mezclen
        if (confirm("¿Limpiar también los datos locales (reuniones, docentes)? Recomendado por seguridad.")) {
            indexedDB.deleteDatabase('CTE_Database');
        }
        
        this.updateUI();
        app.checkAuthAndRoute();
    },

    updateUI() {
        const userInfoEl = document.getElementById('user-info-display');
        const loginView = document.getElementById('view-login');
        const adminLink = document.getElementById('nav-link-admin');
        const userCreditsEl = document.getElementById('user-credits-display');

        if (this.isLoggedIn()) {
            if (userInfoEl) {
                userInfoEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        ${this.user.picture ? `<img src="${this.user.picture}" style="width:24px; border-radius:50%;">` : '<i class="fa-solid fa-user-circle"></i>'}
                        <span style="font-size:0.9rem; font-weight:500;">${this.user.name}</span>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">
                        ${this.user.role === 'admin' ? 'Administrador' : `Créditos: <strong id="credits-count-badge">${this.user.credits || 0}</strong>`}
                    </div>
                `;
            }
            if (adminLink) {
                adminLink.style.display = this.isAdmin() ? 'block' : 'none';
            }
            if (userCreditsEl && !this.isAdmin()) {
                userCreditsEl.style.display = 'block';
                document.getElementById('credits-amount').innerText = this.user.credits || 0;
            }
        } else {
            if (userInfoEl) userInfoEl.innerHTML = '';
            if (adminLink) adminLink.style.display = 'none';
            if (userCreditsEl) userCreditsEl.style.display = 'none';
        }
    },

    getAuthHeaders() {
        return this.token ? { 'Authorization': `Bearer ${this.token}` } : {};
    },
    
    async fetchUsersForAdmin() {
        try {
            const res = await fetch(`${app.apiBaseUrl}/admin/users`, {
                headers: this.getAuthHeaders()
            });
            return await res.json();
        } catch (e) {
            console.error(e);
            return [];
        }
    },
    
    async buyCredits() {
        try {
            app.showLoading("Redirigiendo a Mercado Pago...");
            const res = await fetch(`${app.apiBaseUrl}/payments/create-preference`, {
                method: 'POST',
                headers: { 
                    ...this.getAuthHeaders(),
                    'Content-Type': 'application/json'
                }
            });
            const data = await res.json();
            
            if (data.init_point) {
                window.location.href = data.init_point;
            } else {
                app.hideLoading();
                alert("No se pudo generar el link de pago.");
            }
        } catch (error) {
            app.hideLoading();
            console.error(error);
            alert("Error al conectar con Mercado Pago.");
        }
    },
    
    // Método para simular compra (solo desarrollo)
    async mockBuyCredits() {
        try {
            app.showLoading("Agregando crédito...");
            const res = await fetch(`${app.apiBaseUrl}/payments/mock-success`, {
                method: 'POST',
                headers: { ...this.getAuthHeaders() }
            });
            const data = await res.json();
            if (data.success) {
                this.user.credits = (this.user.credits || 0) + 1;
                this.setSession(this.token, this.user);
                app.hideLoading();
                alert("Crédito agregado exitosamente.");
            }
        } catch (e) {
            app.hideLoading();
        }
    }
};

window.authModule = authModule;
