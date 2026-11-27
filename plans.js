// Planos e pagamentos (Mercado Pago via API própria em Cloudflare Workers).
import { getToken, hasValidToken } from './auth.js?v=2.11.2';

// Endereço do Worker publicado (ex.: 'https://napista-api.SEU-USUARIO.workers.dev').
// Vazio = cobrança desligada: tudo liberado e sem anúncios (útil antes de publicar a API).
export const BILLING_API = '';

// Google AdSense (opcional). Vazio = mostra só o aviso "Remover anúncios".
export const ADSENSE = { client: '', slot: '' };

const CACHE_KEY = 'napista_plan';
const RANK = { free: 0, semanuncios: 1, medio: 2, completo: 3 };

// Cópia local dos preços (a API manda a lista oficial em /plan).
export const DEFAULT_CATALOG = {
    semanuncios: { name: 'Sem anúncios', rank: 1, available: true, periods: { mensal: { amount: 4.90, days: 30 }, anual: { amount: 44.90, days: 365 } } },
    medio: { name: 'Médio', rank: 2, available: true, periods: { mensal: { amount: 9.90, days: 30 }, anual: { amount: 89.90, days: 365 } } },
    completo: { name: 'Completo', rank: 3, available: false, periods: { mensal: { amount: 19.90, days: 30 }, anual: { amount: 169.90, days: 365 } } }
};

let current = readCache();

function readCache() {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (c && typeof c.plan === 'string') return c;
    } catch { /* ignora */ }
    return { plan: 'free', expiresAt: null, catalog: null };
}

function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)); } catch { /* ignora */ }
}

export const billingEnabled = () => !!BILLING_API;

/** Plano em vigor agora (considera a validade guardada no aparelho, mesmo offline). */
export function currentPlan() {
    if (!billingEnabled()) return 'completo';
    if (current.plan !== 'free' && current.expiresAt && current.expiresAt < Date.now()) return 'free';
    return current.plan;
}

export const planExpiresAt = () => (currentPlan() === 'free' ? null : current.expiresAt);
export const catalog = () => current.catalog || DEFAULT_CATALOG;
export const planName = (id) => (id === 'free' ? 'Grátis' : catalog()[id]?.name || id);
const atLeast = (id) => RANK[currentPlan()] >= RANK[id];

export const can = {
    noAds: () => atLeast('semanuncios'),
    createGoals: () => atLeast('medio'),
    finance: () => atLeast('completo')
};

async function api(path, options = {}) {
    const token = await getToken();
    const res = await fetch(BILLING_API + path, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.message || `API ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

/**
 * Atualiza o plano com a API. Sem login válido, mantém o que está salvo
 * (não abre popup). Resolve `true` se o plano mudou.
 */
export async function refreshPlan() {
    if (!billingEnabled() || !hasValidToken()) return false;
    const before = currentPlan() + current.expiresAt;
    const data = await api('/plan');
    current = { plan: data.plan, expiresAt: data.expiresAt, catalog: data.catalog || null };
    writeCache();
    return before !== currentPlan() + current.expiresAt;
}

/** Abre o pagamento do Mercado Pago. Chamar dentro de um toque (pode pedir login). */
export async function startCheckout(plan, period) {
    const { url } = await api('/checkout', { method: 'POST', body: JSON.stringify({ plan, period }) });
    if (!url) throw new Error('Link de pagamento indisponível.');
    location.href = url;
}

export function clearPlan() {
    current = { plan: 'free', expiresAt: null, catalog: null };
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignora */ }
}
