import axios from 'axios';

// Always same-origin: Vite proxies /api to the backend in dev, and a Vercel
// rewrite proxies it to Railway in production. Calling the Railway domain
// directly would make the auth cookie third-party, which iOS browsers block.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
