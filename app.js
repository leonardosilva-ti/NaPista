import { initAuth, isAuthReady, login, getToken, logout, hasValidToken, invalidateToken, setAccountHint, getAccountHint } from './auth.js';
import { findDataFile, readData, saveData, deleteData, getUserEmail } from './drive.js';
import * as L from './logic.js';

// ═══════════════════════ Constantes ═══════════════════════
const PRESET_PLATFORMS = ['Uber', '99', 'InDrive', 'Particular', 'iFood', 'Shopee', 'Mercado Livre', 'Lalamove'];
const EXPENSE_SUGGESTIONS = ['Almoço', 'Lanche', 'Café', 'Água', 'Pedágio', 'Estacionamento', 'Lavagem', 'Manutenção'];
const PLATFORM_COLORS = ['#10b981', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#22d3ee', '#fb7185', '#84cc16'];
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MAIN_SCREENS = ['dashboard-screen', 'reports-screen', 'goals-screen', 'profile-screen'];
const CACHE_KEY = 'napista_cache';     // cópia local dos dados (abre o app sem precisar de login)
const OLD_PENDING_KEY = 'napista_pending';
const PULL_INTERVAL_MS = 5 * 60 * 1000;

const ICON_TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

// ═══════════════════════ Estado ═══════════════════════
const state = {
    data: null,
    fileId: null,
    scope: 'day',
    anchor: L.startOfDay(new Date()),     // data de referência do período exibido
    dayAnchor: L.startOfDay(new Date()),  // último dia escolhido (para voltar ao escopo "dia")
    reportTab: 'days',
    reportKey: null,
    range: null,
    setupPlatforms: [],
    setupOptions: [],
    editingExpense: null,
    reportExpenses: [],
    editingGoal: null,
    goalWeekdays: []
};

// ═══════════════════════ Utilidades ═══════════════════════
const $ = (id) => document.getElementById(id);
const brl = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v, digits = 1) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayDate = () => L.startOfDay(new Date());
const settings = () => state.data.settings;
const pad2 = (n) => String(n).padStart(2, '0');
const shortDate = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;

function parseDecimal(v) {
    if (typeof v === 'number') return v;
    const s = String(v ?? '').trim();
    if (!s) return 0;
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : 0;
}

const moneyInput = (v) => (v > 0 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const decimalInput = (v) => (v > 0 ? String(Math.round(v * 100) / 100).replace('.', ',') : '');

function maskMoney(input) {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
    input.value = digits ? (parseInt(digits, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
}

function maskDecimal(input) {
    let v = input.value.replace(/[^\d.,]/g, '').replace('.', ',');
    const i = v.indexOf(',');
    if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/,/g, '').slice(0, 2);
    input.value = v.slice(0, 8);
}

function platformColor(name) {
    const list = state.data?.settings?.plataformas || [];
    let idx = list.indexOf(name);
    if (idx === -1) idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
    return PLATFORM_COLORS[idx % PLATFORM_COLORS.length];
}

function findDay(key) {
    return state.data.history.find(h => h.date === key);
}

function getOrCreateDay(key) {
    let day = findDay(key);
    if (!day) {
        day = { date: key, earnings: {}, km: 0, expenses: 0, detailedExpenses: [] };
        state.data.history.push(day);
        state.data.history.sort((a, b) => a.date.localeCompare(b.date));
    }
    return day;
}

function pruneDay(day) {
    const empty = !Object.keys(day.earnings || {}).length && !L.num(day.km)
        && !day.consumoL && !day.precoL && !(day.detailedExpenses || []).length;
    if (empty) state.data.history = state.data.history.filter(h => h !== day);
}

function normalizeData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    data.settings = { ...L.defaultSettings(), ...(data.settings || {}) };
    if (!Array.isArray(data.settings.plataformas)) data.settings.plataformas = [];

    const seen = new Set();
    data.history = (Array.isArray(data.history) ? data.history : []).filter(d => {
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || seen.has(d.date)) return false;
        seen.add(d.date);
        return true;
    });

    data.history.forEach(d => {
        if (!d.earnings || typeof d.earnings !== 'object') d.earnings = {};
        if (!Array.isArray(d.detailedExpenses)) {
            d.detailedExpenses = L.num(d.expenses) > 0 ? [{ desc: 'Gastos gerais', val: L.num(d.expenses) }] : [];
        }
        d.expenses = L.dayExpenses(d);
    });
    data.history.sort((a, b) => a.date.localeCompare(b.date));

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    data.goals = (Array.isArray(data.goals) ? data.goals : []).filter(g =>
        g && g.id && L.num(g.amount) > 0 && dateRe.test(g.startDate) && dateRe.test(g.deadline));
    data.goals.forEach(g => {
        if (!Array.isArray(g.weekdays) || !g.weekdays.length) g.weekdays = [...L.ALL_WEEKDAYS];
    });
    return data;
}

// ═══════════════════════ Feedback (toast / confirm) ═══════════════════════
let toastTimer;
function toast(message, { type = 'info', action, onAction, duration = 3500 } = {}) {
    const el = $('toast');
    const btn = $('toast-action');
    $('toast-msg').textContent = message;
    el.dataset.type = type;
    btn.hidden = !action;
    btn.textContent = action || '';
    btn.onclick = () => { el.classList.remove('show'); onAction?.(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false }) {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    const ok = $('confirm-ok');
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    return new Promise(resolve => {
        const done = (result) => { dlg.close(); resolve(result); };
        ok.onclick = () => done(true);
        $('confirm-cancel').onclick = () => done(false);
        dlg.oncancel = () => resolve(false);
        dlg.showModal();
    });
}

// ═══════════════════════ Sincronização com o Drive ═══════════════════════
// Os dados ficam sempre numa cópia local (localStorage). O app abre direto
// dessa cópia, sem pedir login; o Google Drive é sincronizado quando há um
// token válido. O token do Google dura só 1 hora e só pode ser renovado com
// um toque do usuário (popup), então a renovação acontece apenas quando é
// preciso sincronizar — e, com o e-mail salvo como dica, o popup fecha sozinho.
let changeVersion = 0;
let savedVersion = 0;
let saveTimer = null;
let inflight = null;
let saveAgain = false;
let authToastShown = false;
let syncing = null;
let lastPull = 0;
let autoRenewTried = false;

const SYNC_LABELS = {
    saved: 'Salvo',
    pending: 'Alterado',
    saving: 'Salvando…',
    error: 'Não salvo · tentar',
    auth: 'Sincronizar',
    stale: 'Sincronizar',
    offline: 'Offline'
};

function setSync(status) {
    const pill = $('sync-pill');
    pill.dataset.state = status;
    $('sync-label').textContent = SYNC_LABELS[status];
    pill.title = status === 'error' ? 'Toque para tentar salvar novamente'
        : status === 'auth' ? 'Alterações salvas no aparelho. Toque para enviar ao Google Drive.'
        : status === 'stale' ? 'Mostrando os dados salvos no aparelho. Toque para buscar a versão do Google Drive.' : '';
    if (status === 'auth' && !authToastShown) {
        authToastShown = true;
        toast('Alterações guardadas no aparelho. Toque em "Sincronizar" para enviar ao Drive.', {
            action: 'Sincronizar', duration: 8000, onAction: () => syncNow()
        });
    }
    if (status === 'saved') authToastShown = false;
}

const hasUnsaved = () => changeVersion !== savedVersion;
const needsSync = () => hasUnsaved() || !lastPull;

function writeCache() {
    if (!state.data) return;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            fileId: state.fileId, dirty: hasUnsaved(), updatedAt: Date.now(), data: state.data
        }));
    } catch { /* sem espaço / modo privado */ }
}

function readCache() {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cache?.data) return cache;
        // formato antigo: só existia cópia local de alterações não salvas
        const old = JSON.parse(localStorage.getItem(OLD_PENDING_KEY) || 'null');
        if (old?.data) return { fileId: old.fileId, dirty: true, data: old.data };
    } catch { /* ignora */ }
    return null;
}

function clearCache() {
    try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(OLD_PENDING_KEY);
    } catch { /* ignora */ }
}

/** Registra uma alteração: guarda cópia local e agenda envio ao Drive. */
function markChanged(delay = 1500) {
    changeVersion++;
    writeCache();
    setSync('pending');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, delay);
}

/**
 * Envia os dados ao Drive. Sem `interactive` (salvamento automático), não tenta
 * renovar o login — o navegador bloquearia o popup fora de um clique.
 */
function flushSave(interactive = false) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (inflight) { saveAgain = true; return inflight; }
    if (!hasUnsaved() || !state.data) return Promise.resolve();
    if (!interactive && !hasValidToken()) { setSync(navigator.onLine ? 'auth' : 'offline'); return Promise.resolve(); }

    const version = changeVersion;
    setSync('saving');
    inflight = saveData(state.fileId, state.data)
        .then(id => {
            state.fileId = id;
            savedVersion = version;
            lastPull = lastPull || Date.now();
            writeCache();
            if (!hasUnsaved()) setSync('saved');
        })
        .catch(err => {
            console.error('Erro ao salvar:', err);
            setSync(!navigator.onLine ? 'offline' : (err?.name === 'AuthError' || err?.status === 401) ? 'auth' : 'error');
        })
        .finally(() => {
            inflight = null;
            if (saveAgain) { saveAgain = false; if (hasUnsaved()) flushSave(); }
        });
    return inflight;
}

function resetSync() {
    clearTimeout(saveTimer);
    changeVersion = savedVersion = 0;
    saveAgain = false;
    lastPull = 0;
    setSync('saved');
}

/**
 * Sincroniza com o Drive: se há alterações locais, envia; senão, busca a versão
 * do Drive (pode ter sido alterada em outro aparelho). Requer token válido.
 */
function syncWithDrive() {
    if (syncing) return syncing;
    if (!hasValidToken()) {
        setSync(hasUnsaved() ? 'auth' : 'stale');
        return Promise.resolve();
    }
    syncing = (async () => {
        try {
            if (!hasUnsaved()) setSync('saving');
            const fileId = await findDataFile();
            if (hasUnsaved()) {
                state.fileId = fileId; // se o arquivo sumiu (apagado em outro aparelho), cria um novo
                await flushSave();
                return;
            }
            const remote = fileId ? await readData(fileId) : null;
            if (hasUnsaved()) { await flushSave(); return; } // usuário alterou algo durante o download
            state.fileId = fileId;
            lastPull = Date.now();
            if (remote) {
                const incoming = normalizeData(remote);
                if (JSON.stringify(incoming) !== JSON.stringify(state.data)) {
                    state.data = incoming;
                    rerenderAfterSync();
                }
            } else if (fileId === null && state.data) {
                // nada no Drive ainda: envia a cópia local
                changeVersion++;
                await flushSave();
                return;
            }
            writeCache();
            setSync('saved');
            if (!getAccountHint()) getUserEmail().then(setAccountHint).catch(() => {});
        } catch (e) {
            console.error('Erro ao sincronizar:', e);
            const authErr = e?.name === 'AuthError' || e?.status === 401;
            if (authErr) invalidateToken();
            setSync(!navigator.onLine ? 'offline' : authErr ? (hasUnsaved() ? 'auth' : 'stale') : 'error');
        } finally {
            syncing = null;
        }
    })();
    return syncing;
}

/** Renova o token (precisa ser chamado dentro de um toque) e sincroniza. */
function syncNow() {
    if (!isAuthReady()) { toast('Sem conexão com o Google no momento.', { type: 'error' }); return; }
    const renew = hasValidToken() ? Promise.resolve() : getToken(); // abre o popup ainda dentro do toque
    renew.then(() => syncWithDrive()).catch(e => {
        console.error(e);
        if (e?.type !== 'popup_closed') toast('Não foi possível conectar ao Google. Tente novamente.', { type: 'error' });
        setSync(hasUnsaved() ? 'auth' : 'stale');
    });
}

function rerenderAfterSync() {
    renderPlatformInputs();
    const active = document.querySelector('.screen.active')?.id;
    if (active === 'dashboard-screen') renderDashboard();
    else if (active === 'reports-screen') renderReports();
    else if (active === 'goals-screen') renderGoals();
    else if (active === 'profile-screen') renderProfile();
    else if (active === 'setup-screen' && L.isConfigured(settings())) showScreen('dashboard-screen');
}

// ═══════════════════════ Navegação ═══════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    const isMain = MAIN_SCREENS.includes(id);
    $('bottom-nav').hidden = !isMain;
    $('appbar').hidden = !(isMain || id === 'setup-screen');
    document.body.classList.toggle('has-nav', isMain);
    document.querySelectorAll('.nav-item').forEach(b => {
        const active = b.dataset.target === id;
        b.classList.toggle('active', active);
        if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0 });

    if (id === 'dashboard-screen') renderDashboard();
    if (id === 'reports-screen') renderReports();
    if (id === 'goals-screen') renderGoals();
    if (id === 'profile-screen') renderProfile();
}

function showLoading(message = 'Carregando…') {
    $('loading-message').textContent = message;
    $('loading-spinner').hidden = false;
    $('btn-retry').hidden = true;
    showScreen('loading-screen');
}

function showLoadError(message, retry) {
    $('loading-message').textContent = message;
    $('loading-spinner').hidden = true;
    const btn = $('btn-retry');
    btn.hidden = false;
    btn.onclick = retry;
    showScreen('loading-screen');
}

// ═══════════════════════ Inicialização / login ═══════════════════════
async function boot() {
    const cache = readCache();
    if (cache) {
        // Abre na hora com os dados do aparelho; o login do Google carrega em segundo plano.
        openWithData(cache.data, cache.fileId, !!cache.dirty);
        initAuth()
            .then(ok => { if (ok) syncWithDrive(); else setSync(hasUnsaved() ? 'auth' : 'stale'); })
            .catch(e => { console.error(e); setSync(navigator.onLine ? (hasUnsaved() ? 'auth' : 'stale') : 'offline'); });
        return;
    }

    showLoading();
    try {
        const hasSession = await initAuth();
        if (hasSession) await loadUserData();
        else showScreen('login-screen');
    } catch (e) {
        console.error(e);
        showLoadError('Não foi possível carregar o login do Google. Verifique sua conexão ou desative bloqueadores de anúncio.', () => location.reload());
    }
}

function openWithData(data, fileId, dirty = false) {
    resetSync();
    state.data = normalizeData(data);
    state.fileId = fileId ?? null;
    state.anchor = state.dayAnchor = todayDate();
    state.scope = 'day';
    if (dirty) changeVersion = 1;
    writeCache();
    renderPlatformInputs();
    if (L.isConfigured(state.data.settings)) showScreen('dashboard-screen');
    else openSetup();
}

async function handleLogin() {
    const btn = $('btn-login');
    btn.disabled = true;
    try {
        await login(); // abre o popup de forma síncrona dentro do clique
        await loadUserData();
    } catch (e) {
        console.error(e);
        if (e?.type !== 'popup_closed') toast('Não foi possível entrar. Tente novamente.', { type: 'error' });
    } finally {
        btn.disabled = false;
    }
}

async function loadUserData() {
    showLoading('Carregando seus dados…');
    try {
        const fileId = await findDataFile();
        const data = fileId ? await readData(fileId) : null;
        openWithData(data, fileId);
        lastPull = Date.now();
        getUserEmail().then(setAccountHint).catch(() => {});
    } catch (e) {
        console.error(e);
        if (e?.name === 'AuthError' || e?.status === 401 || e?.status === 403) {
            invalidateToken();
            showScreen('login-screen');
            toast('Não foi possível acessar sua conta. Entre novamente.');
        } else {
            showLoadError('Não foi possível acessar seu Google Drive. Verifique a conexão.', loadUserData);
        }
    }
}

// ═══════════════════════ Configuração (metas) ═══════════════════════
function openSetup() {
    const s = settings();
    const configured = L.isConfigured(s);
    $('setup-title').textContent = configured ? 'Editar metas' : 'Primeiros passos';
    $('btn-finish-setup').textContent = configured ? 'Salvar alterações' : 'Salvar e começar';
    $('btn-cancel-setup').hidden = !configured;

    $('setup-dias').value = s.diasTrabalhoMes || '';
    $('setup-meta').value = moneyInput(L.num(s.metaLiquidaMensal));
    $('setup-pagamento-km').value = moneyInput(L.num(s.mediaPagamentoKm));
    $('setup-consumo').value = decimalInput(L.num(s.mediaConsumoL));
    $('setup-preco-comb').value = moneyInput(L.num(s.mediaPrecoCombustivel));

    state.setupPlatforms = [...s.plataformas];
    state.setupOptions = [...new Set([...PRESET_PLATFORMS, ...s.plataformas])];
    renderSetupPlatforms();
    updateSetupPreview();
    showScreen('setup-screen');
}

function readSetupForm() {
    return {
        diasTrabalhoMes: parseInt($('setup-dias').value, 10) || 0,
        metaLiquidaMensal: parseDecimal($('setup-meta').value),
        mediaPagamentoKm: parseDecimal($('setup-pagamento-km').value),
        mediaConsumoL: parseDecimal($('setup-consumo').value),
        mediaPrecoCombustivel: parseDecimal($('setup-preco-comb').value)
    };
}

function updateSetupPreview() {
    const f = readSetupForm();
    const el = $('setup-preview');
    if (!f.mediaConsumoL || !f.mediaPrecoCombustivel || !f.mediaPagamentoKm) { el.hidden = true; return; }

    const custoKm = f.mediaPrecoCombustivel / f.mediaConsumoL;
    const lucroKm = f.mediaPagamentoKm - custoKm;
    el.hidden = false;
    el.classList.toggle('warn', lucroKm <= 0);

    if (lucroKm <= 0) {
        el.innerHTML = `<div>O combustível custa <strong>${brl(custoKm)}/km</strong>, mais do que você recebe por km. Assim não há lucro. Revise os valores.</div>`;
        return;
    }

    const rows = [
        ['Custo de combustível por km', brl(custoKm)],
        ['Lucro por km', brl(lucroKm)]
    ];
    if (f.metaLiquidaMensal && f.diasTrabalhoMes) {
        const metaDia = f.metaLiquidaMensal / f.diasTrabalhoMes;
        rows.push(['Meta líquida por dia', brl(metaDia)]);
        rows.push(['Rodagem estimada por dia', `${fmt(metaDia / lucroKm, 0)} km`]);
    }
    el.innerHTML = rows.map(([k, v]) => `<div class="preview-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function renderSetupPlatforms() {
    $('setup-platforms').innerHTML = state.setupOptions.map(p => `
        <button type="button" class="chip" data-platform="${esc(p)}" aria-pressed="${state.setupPlatforms.includes(p)}">${esc(p)}</button>
    `).join('');
}

function addCustomPlatform() {
    const input = $('setup-other-app');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const existing = state.setupOptions.find(p => p.toLowerCase() === name.toLowerCase());
    const finalName = existing || name;
    if (!existing) state.setupOptions.push(finalName);
    if (!state.setupPlatforms.includes(finalName)) state.setupPlatforms.push(finalName);
    input.value = '';
    renderSetupPlatforms();
}

function saveSetup(e) {
    e.preventDefault();
    const f = readSetupForm();
    const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };

    if (!(f.metaLiquidaMensal > 0)) return fail('Informe sua meta líquida mensal.', 'setup-meta');
    if (!(f.diasTrabalhoMes >= 1 && f.diasTrabalhoMes <= 31)) return fail('Dias de trabalho devem estar entre 1 e 31.', 'setup-dias');
    if (!(f.mediaPagamentoKm > 0)) return fail('Informe a média que você aceita por km.', 'setup-pagamento-km');
    if (!(f.mediaConsumoL > 0)) return fail('Informe o consumo médio do veículo.', 'setup-consumo');
    if (!(f.mediaPrecoCombustivel > 0)) return fail('Informe o preço do litro.', 'setup-preco-comb');
    if (f.mediaPagamentoKm <= f.mediaPrecoCombustivel / f.mediaConsumoL) return fail('O custo do combustível por km está maior que o ganho por km.', 'setup-pagamento-km');
    if (!state.setupPlatforms.length) return fail('Selecione pelo menos um aplicativo.');

    const wasConfigured = L.isConfigured(settings());
    // mantém a ordem das opções exibidas
    const plataformas = state.setupOptions.filter(p => state.setupPlatforms.includes(p));
    state.data.settings = { ...settings(), ...f, plataformas };
    renderPlatformInputs();
    markChanged(0);
    toast(wasConfigured ? 'Metas atualizadas.' : 'Tudo pronto! Bom trabalho na pista.');
    showScreen('dashboard-screen');
}

// ═══════════════════════ Início (dashboard) ═══════════════════════
function renderPlatformInputs() {
    $('platform-inputs').innerHTML = settings().plataformas.map(p => `
        <label class="field field-inline">
            <span class="field-label"><span class="plat-dot" style="--c:${platformColor(p)}"></span>${esc(p)}</span>
            <span class="input-wrap"><span class="prefix">R$</span><input type="text" inputmode="numeric" class="money day-input plat-input" data-plat="${esc(p)}" placeholder="0,00" autocomplete="off"></span>
        </label>
    `).join('');
}

const dayKey = () => L.toDateKey(state.anchor);

function renderDashboard() {
    if (!state.data) return;
    const isDay = state.scope === 'day';
    document.querySelectorAll('#scope-seg .seg-btn').forEach(b => {
        const active = b.dataset.scope === state.scope;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active);
    });
    $('day-entry').hidden = !isDay;
    $('btn-add-expense').hidden = !isDay;
    renderDateNav();
    if (isDay) fillDayForm();
    refreshDashboard();
}

function refreshDashboard() {
    const r = L.calculateTargets(state.scope, settings(), state.data.history, state.anchor, new Date());
    renderHero(r);
    renderStats(r.summary);
    renderExpenses(r.summary);
    renderGoalWidget();
}

function renderDateNav() {
    const a = state.anchor;
    const today = todayDate();
    const { start, end } = L.getPeriodRange(state.scope, a);
    const containsToday = today >= start && today <= end;
    let title, sub;

    if (state.scope === 'day') {
        const diff = Math.round((a - today) / 86400000);
        title = diff === 0 ? 'Hoje' : diff === -1 ? 'Ontem' : diff === 1 ? 'Amanhã' : WEEKDAYS[a.getDay()];
        sub = `${diff >= -1 && diff <= 1 ? WEEKDAYS[a.getDay()] + ', ' : ''}${a.getDate()} de ${MONTHS[a.getMonth()].toLowerCase()}${a.getFullYear() !== today.getFullYear() ? ' de ' + a.getFullYear() : ''}`;
    } else if (state.scope === 'week') {
        const weeksDiff = Math.round((start - L.getWeekRange(today).start) / (7 * 86400000));
        title = weeksDiff === 0 ? 'Esta semana' : weeksDiff === -1 ? 'Semana passada' : 'Semana';
        sub = `${shortDate(start)} a ${shortDate(end)}${end.getFullYear() !== today.getFullYear() ? '/' + end.getFullYear() : ''}`;
    } else {
        title = `${MONTHS[a.getMonth()]}${a.getFullYear() !== today.getFullYear() ? ' ' + a.getFullYear() : ''}`;
        sub = containsToday ? 'Este mês' : `${shortDate(start)} a ${shortDate(end)}`;
    }

    $('date-title').textContent = title;
    $('date-sub').textContent = sub;
    $('btn-today').hidden = containsToday;
}

function navigateDate(direction) {
    const a = new Date(state.anchor);
    if (state.scope === 'day') a.setDate(a.getDate() + direction);
    else if (state.scope === 'week') a.setDate(a.getDate() + direction * 7);
    else { a.setDate(1); a.setMonth(a.getMonth() + direction); }
    setAnchor(a);
}

function setAnchor(date) {
    state.anchor = L.startOfDay(date);
    if (state.scope === 'day') state.dayAnchor = new Date(state.anchor);
    renderDashboard();
}

function setScope(scope) {
    if (scope === state.scope) return;
    if (scope === 'day') {
        // Volta ao último dia escolhido se ele estiver no período exibido;
        // senão, hoje (se estiver no período) ou o primeiro dia do período.
        const { start, end } = L.getPeriodRange(state.scope, state.anchor);
        const today = todayDate();
        const inRange = (d) => d >= start && d <= end;
        state.anchor = inRange(state.dayAnchor) ? new Date(state.dayAnchor) : inRange(today) ? today : new Date(start);
        state.dayAnchor = new Date(state.anchor);
    }
    state.scope = scope;
    renderDashboard();
}

function openDatePicker() {
    const picker = $('date-picker');
    picker.value = L.toDateKey(state.anchor);
    try {
        if (typeof picker.showPicker === 'function') picker.showPicker();
        else { picker.focus(); picker.click(); }
    } catch {
        picker.focus();
        picker.click();
    }
}

function fillDayForm() {
    const s = settings();
    const day = findDay(dayKey());
    document.querySelectorAll('.plat-input').forEach(inp => {
        inp.value = moneyInput(L.num(day?.earnings?.[inp.dataset.plat]));
    });
    $('day-km').value = decimalInput(L.num(day?.km));
    $('day-consumo').value = decimalInput(L.num(day?.consumoL));
    $('day-preco').value = moneyInput(L.num(day?.precoL));
    $('day-consumo').placeholder = fmt(L.num(s.mediaConsumoL));
    $('day-preco').placeholder = moneyInput(L.num(s.mediaPrecoCombustivel));
}

function commitDayForm() {
    const key = dayKey();
    let day = findDay(key);
    const earnings = { ...(day?.earnings || {}) }; // preserva apps que não estão mais nas configurações
    document.querySelectorAll('.plat-input').forEach(inp => {
        const v = parseDecimal(inp.value);
        if (v > 0) earnings[inp.dataset.plat] = v;
        else delete earnings[inp.dataset.plat];
    });
    const km = parseDecimal($('day-km').value);
    const consumo = parseDecimal($('day-consumo').value);
    const preco = parseDecimal($('day-preco').value);

    if (!day) {
        if (!Object.keys(earnings).length && !km && !consumo && !preco) return;
        day = getOrCreateDay(key);
    }
    day.earnings = earnings;
    day.km = km;
    if (consumo > 0) day.consumoL = consumo; else delete day.consumoL;
    if (preco > 0) day.precoL = preco; else delete day.precoL;
    pruneDay(day);

    markChanged();
    refreshDashboard();
}

function renderHero(r) {
    const hero = $('hero');
    const word = { day: 'do dia', week: 'da semana', month: 'do mês' }[state.scope];
    const tip = $('hero-tip');
    const fix = $('hero-fix');
    tip.hidden = true;
    fix.hidden = true;

    if (r.error) {
        hero.dataset.state = 'error';
        $('hero-label').textContent = 'Revise suas metas';
        $('hero-value').textContent = 'Sem lucro por km';
        $('hero-sub').textContent = r.error;
        $('hero-badge').textContent = '—';
        $('hero-progress').style.width = '0%';
        $('hero-net').textContent = brl(r.summary.net);
        $('hero-target').textContent = '—';
        fix.hidden = false;
        return;
    }

    const pct = Math.round(r.progress * 100);
    $('hero-badge').textContent = `${pct}%`;
    $('hero-progress').style.width = `${pct}%`;
    $('hero-progressbar').setAttribute('aria-valuenow', pct);
    $('hero-net').textContent = brl(r.summary.net);
    $('hero-target').textContent = brl(r.meta);

    if (r.metaAlcancada) {
        hero.dataset.state = 'done';
        $('hero-label').textContent = `Meta ${word} batida`;
        $('hero-value').textContent = `+ ${brl(r.excedente)}`;
        $('hero-sub').textContent = 'acima da meta líquida';
        if (r.status === 'current') {
            tip.hidden = false;
            tip.textContent = 'Tudo o que entrar agora é lucro extra. Uma folga também vale.';
        }
    } else if (r.status === 'past') {
        hero.dataset.state = 'missed';
        $('hero-label').textContent = `Faltou para a meta ${word}`;
        $('hero-value').textContent = brl(r.faltaLiquido);
        $('hero-sub').textContent = 'de lucro líquido';
    } else {
        hero.dataset.state = 'progress';
        const label = { day: 'Falta faturar no dia', week: 'Falta faturar na semana', month: 'Falta faturar no mês' }[state.scope];
        $('hero-label').textContent = label;
        $('hero-value').textContent = brl(r.brutoFaltante);
        $('hero-sub').textContent = `bruto · cerca de ${fmt(r.kmFaltante, 0)} km a mais · ${brl(r.faltaLiquido)} líquido`;
        if (state.scope !== 'day' && r.diasRestantes > 0) {
            tip.hidden = false;
            tip.textContent = r.diasRestantes === 1
                ? `Último dia de trabalho do período: ${brl(r.brutoFaltante)} brutos.`
                : `Sugestão: ${brl(r.brutoPorDia)} por dia (≈ ${fmt(r.kmPorDia, 0)} km) nos próximos ${r.diasRestantes} dias de trabalho.`;
        }
    }
}

function renderStats(sum) {
    $('stat-gross').textContent = brl(sum.gross);
    $('stat-fuel').textContent = brl(sum.fuel);
    $('stat-fuel-sub').textContent = sum.km > 0 ? `${fmt(sum.liters, 1)} L estimados` : 'estimado';
    $('stat-exp').textContent = brl(sum.expenses);
    $('stat-km').textContent = `${fmt(sum.km, sum.km % 1 ? 1 : 0)} km`;
    $('stat-km-sub').textContent = sum.km > 0 && sum.gross > 0 ? `${brl(sum.grossPerKm)}/km` : '';
    $('day-gross-total').textContent = brl(sum.gross);
}

function renderExpenses(sum) {
    const list = $('expense-list');
    const isDay = state.scope === 'day';
    $('expense-total').textContent = sum.expenses > 0 ? brl(sum.expenses) : '';

    if (isDay) {
        const items = findDay(dayKey())?.detailedExpenses || [];
        list.innerHTML = items.length
            ? items.map((e, i) => `
                <li class="list-item">
                    <button type="button" class="item-main" data-edit="${i}">
                        <span class="item-title">${esc(e.desc)}</span>
                        <span class="item-sub">Toque para editar</span>
                    </button>
                    <span class="item-value neg">${brl(L.num(e.val))}</span>
                    <button type="button" class="icon-btn" data-del="${i}" aria-label="Remover ${esc(e.desc)}">${ICON_TRASH}</button>
                </li>`).join('')
            : '<li class="empty">Nenhum gasto neste dia.</li>';
    } else {
        list.innerHTML = sum.expenseItems.length
            ? sum.expenseItems.map(e => {
                const d = L.parseDateKey(e.date);
                return `
                <li class="list-item">
                    <div class="item-main">
                        <span class="item-title">${esc(e.desc)}</span>
                        <span class="item-sub">${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}</span>
                    </div>
                    <span class="item-value neg">${brl(e.val)}</span>
                </li>`;
            }).join('')
            : `<li class="empty">Nenhum gasto ${state.scope === 'week' ? 'nesta semana' : 'neste mês'}.</li>`;
    }
}

// ── Gastos ──
function openExpenseDialog(index = null) {
    const day = findDay(dayKey());
    const item = index !== null ? day?.detailedExpenses?.[index] : null;
    state.editingExpense = item ? index : null;
    $('expense-dialog-title').textContent = item ? 'Editar gasto' : 'Novo gasto';
    $('expense-desc').value = item?.desc || '';
    $('expense-val').value = item ? moneyInput(L.num(item.val)) : '';
    $('expense-suggestions').innerHTML = EXPENSE_SUGGESTIONS.map(s => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('');
    $('expense-dialog').showModal();
    if (!item) setTimeout(() => $('expense-desc').focus(), 50);
}

function saveExpense(e) {
    e.preventDefault();
    const desc = $('expense-desc').value.trim();
    const val = parseDecimal($('expense-val').value);
    if (!desc) { toast('Informe a descrição do gasto.', { type: 'error' }); $('expense-desc').focus(); return; }
    if (!(val > 0)) { toast('Informe um valor maior que zero.', { type: 'error' }); $('expense-val').focus(); return; }

    const day = getOrCreateDay(dayKey());
    if (state.editingExpense !== null && day.detailedExpenses[state.editingExpense]) {
        day.detailedExpenses[state.editingExpense] = { desc, val };
    } else {
        day.detailedExpenses.push({ desc, val });
    }
    day.expenses = L.dayExpenses(day);
    $('expense-dialog').close();
    markChanged(600);
    refreshDashboard();
}

function removeExpense(index) {
    const key = dayKey();
    const day = findDay(key);
    if (!day?.detailedExpenses?.[index]) return;
    const [removed] = day.detailedExpenses.splice(index, 1);
    day.expenses = L.dayExpenses(day);
    pruneDay(day);
    markChanged();
    refreshDashboard();

    toast(`"${removed.desc}" removido.`, {
        action: 'Desfazer',
        onAction: () => {
            const d = getOrCreateDay(key);
            d.detailedExpenses.splice(Math.min(index, d.detailedExpenses.length), 0, removed);
            d.expenses = L.dayExpenses(d);
            markChanged();
            refreshDashboard();
        }
    });
}

// ═══════════════════════ Relatórios ═══════════════════════
function buildReportGroups(tab) {
    const history = state.data.history;
    const groups = new Map();
    const add = (key, make, day) => {
        if (!groups.has(key)) groups.set(key, { key, ...make(), days: [] });
        groups.get(key).days.push(day);
    };

    if (tab === 'range') {
        if (!state.range) return [];
        const days = L.filterRange(history, state.range.start, state.range.end);
        const s = L.parseDateKey(state.range.start), e = L.parseDateKey(state.range.end);
        return days.length ? [{ key: 'range', label: `${shortDate(s)}/${s.getFullYear()} a ${shortDate(e)}/${e.getFullYear()}`, days }] : [];
    }

    history.forEach(day => {
        const d = L.parseDateKey(day.date);
        if (tab === 'days') {
            add(day.date, () => ({ label: `${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}`, sub: String(d.getFullYear()) }), day);
        } else if (tab === 'weeks') {
            const { start, end } = L.getWeekRange(d);
            add(L.toDateKey(start), () => ({ label: `${shortDate(start)} a ${shortDate(end)}`, sub: String(end.getFullYear()) }), day);
        } else {
            const key = day.date.slice(0, 7);
            add(key, () => ({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }), day);
        }
    });

    return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function renderReports() {
    if (!state.data) return;
    const tab = state.reportTab;
    document.querySelectorAll('#report-seg .seg-btn').forEach(b => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active);
    });
    $('range-form').hidden = tab !== 'range';

    if (tab === 'range' && !state.range) {
        const today = todayDate();
        state.range = { start: L.toDateKey(new Date(today.getFullYear(), today.getMonth(), 1)), end: L.toDateKey(today) };
    }
    if (tab === 'range') {
        $('range-start').value = state.range.start;
        $('range-end').value = state.range.end;
    }

    const groups = buildReportGroups(tab);
    const hasData = groups.length > 0;
    $('report-empty').hidden = hasData;
    $('report-body').hidden = !hasData;
    if (!hasData) {
        $('report-empty').querySelector('p').textContent = tab === 'range' ? 'Nenhum lançamento nesse período.' : 'Nenhum lançamento por aqui ainda.';
        return;
    }

    const s = settings();
    let selected = groups.find(g => g.key === state.reportKey) || groups[0];
    state.reportKey = selected.key;

    if (tab === 'range') {
        // Na aba período, a lista mostra os dias do intervalo filtrado
        $('report-list-title').textContent = `Dias no período (${selected.days.length})`;
        $('report-list').innerHTML = [...selected.days].sort((a, b) => b.date.localeCompare(a.date)).map(day => {
            const d = L.parseDateKey(day.date);
            return reportRow({ label: `${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}`, sub: String(d.getFullYear()) }, L.summarize([day], s), false);
        }).join('');
    } else {
        $('report-list-title').textContent = { days: 'Dias', weeks: 'Semanas', months: 'Meses' }[tab];
        $('report-list').innerHTML = groups.map(g => reportRow(g, L.summarize(g.days, s), true, g.key === selected.key)).join('');
    }

    renderReportSummary(selected);
}

function reportRow(g, sum, selectable, isSelected = false) {
    const tag = selectable ? 'button' : 'div';
    return `
        <li>
            <${tag} ${selectable ? `type="button" data-group="${esc(g.key)}" aria-pressed="${isSelected}"` : ''} class="list-item ${isSelected ? 'selected' : ''}">
                <span class="item-main">
                    <span class="item-title">${esc(g.label)}</span>
                    <span class="item-sub">${g.sub ? esc(g.sub) + ' · ' : ''}${sum.days > 1 ? `${sum.workedDays} ${sum.workedDays === 1 ? 'dia' : 'dias'} · ` : ''}${fmt(sum.km, 0)} km</span>
                </span>
                <span class="item-value ${sum.net < 0 ? 'neg' : 'pos'}">${brl(sum.net)}<small>bruto ${brl(sum.gross)}</small></span>
            </${tag}>
        </li>`;
}

function renderReportSummary(group) {
    const s = settings();
    const sum = L.summarize(group.days, s);
    state.reportExpenses = sum.expenseItems;

    const kind = { days: '', weeks: 'Semana · ', months: '', range: 'Período · ' }[state.reportTab];
    $('rep-period').textContent = `${kind}${group.label}`;
    $('rep-net').textContent = brl(sum.net);
    $('rep-net').className = `hero-value ${sum.net < 0 ? 'neg' : ''}`;
    $('rep-net-sub').textContent = `lucro líquido · ${sum.workedDays} ${sum.workedDays === 1 ? 'dia trabalhado' : 'dias trabalhados'}`;
    $('rep-gross').textContent = brl(sum.gross);
    $('rep-fuel').textContent = brl(sum.fuel);
    $('rep-exp').textContent = brl(sum.expenses);
    $('rep-km').textContent = `${fmt(sum.km, 0)} km`;
    $('rep-gpk').textContent = sum.km > 0 ? brl(sum.grossPerKm) : '—';
    $('rep-cpk').textContent = brl(sum.costPerKm);
    $('rep-consumo').textContent = `${fmt(sum.avgConsumo)} km/L`;
    $('rep-preco').textContent = brl(sum.avgPreco);

    // Gráfico por aplicativo (inclui apps antigos que existam no histórico)
    const names = [...new Set([...s.plataformas, ...Object.keys(sum.byPlatform)])];
    const rows = names.map(p => ({ p, v: sum.byPlatform[p] || 0 })).sort((a, b) => b.v - a.v);
    const max = Math.max(...rows.map(r => r.v), 0);
    $('report-chart').innerHTML = max === 0
        ? '<p class="muted small">Sem ganhos registrados neste período.</p>'
        : rows.map(({ p, v }) => `
            <div class="hbar">
                <div class="hbar-head"><span>${esc(p)}</span><span>${brl(v)}<small>${sum.gross > 0 ? Math.round(v / sum.gross * 100) : 0}%</small></span></div>
                <div class="hbar-track"><div class="hbar-fill" style="width:${(v / max * 100).toFixed(1)}%; --c:${platformColor(p)}"></div></div>
            </div>`).join('');
}

function openReportExpenses() {
    const items = state.reportExpenses || [];
    $('report-expenses-list').innerHTML = items.length
        ? items.map(e => {
            const d = L.parseDateKey(e.date);
            return `<li class="list-item"><div class="item-main"><span class="item-title">${esc(e.desc)}</span><span class="item-sub">${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}</span></div><span class="item-value neg">${brl(e.val)}</span></li>`;
        }).join('')
        : '<li class="empty">Nenhum gasto extra neste período.</li>';
    $('report-expenses-dialog').showModal();
}

// ═══════════════════════ Metas com prazo ═══════════════════════
const goals = () => state.data.goals;
const goalTitle = (g) => g.name?.trim() || `Meta de ${brl(L.num(g.amount))}`;
const fullDate = (key) => { const d = L.parseDateKey(key); return `${shortDate(d)}/${d.getFullYear()}`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const STATUS_ORDER = { active: 0, scheduled: 1, done: 2, expired: 3 };

function goalResults() {
    const s = settings();
    const now = new Date();
    return goals()
        .map(g => L.goalProgress(g, s, state.data.history, now))
        .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
            || (a.status === 'done' || a.status === 'expired'
                ? b.goal.deadline.localeCompare(a.goal.deadline)
                : a.goal.deadline.localeCompare(b.goal.deadline)));
}

function goalTodayLine(r) {
    if (r.status !== 'active') return '';
    if (!r.todayIsWork) return `<p class="goal-today">Hoje não é dia de trabalho nesta meta. Próximos dias: ${brl(r.porDia)} líquidos por dia.</p>`;
    if (r.hojeFalta <= 0) return '<p class="goal-today ok">Ritmo de hoje cumprido para esta meta.</p>';
    return `<p class="goal-today">Hoje faltam <strong>${brl(r.hojeFalta)}</strong> líquidos para ficar no ritmo.</p>`;
}

function renderGoalWidget() {
    const body = $('goal-widget-body');
    if (!body || !state.data) return;
    const list = goalResults().filter(r => r.status === 'active' || r.status === 'scheduled');

    if (!list.length) {
        const finished = goals().length;
        body.innerHTML = `<p class="goal-empty-text">${finished
            ? 'Nenhuma meta em andamento. Crie uma nova e veja quanto precisa fazer por dia.'
            : 'Tem um objetivo? Diga quanto quer fazer de lucro líquido e até quando: calculamos quanto você precisa fazer por dia.'}</p>
            ${finished ? '<div class="goal-more"><button type="button" class="link-btn" data-goto-goals>Ver metas anteriores</button></div>' : ''}`;
        return;
    }

    const shown = list.slice(0, 2);
    body.innerHTML = shown.map(r => {
        const pct = Math.round(r.progress * 100);
        const sub = r.status === 'scheduled'
            ? `Começa em ${fullDate(r.goal.startDate)}`
            : `${brl(r.porDia)}/dia · ${plural(r.diasRestantes, 'dia', 'dias')} até ${fullDate(r.goal.deadline)}`;
        return `
        <div class="goal-mini">
            <div class="goal-mini-head"><span class="goal-mini-name">${esc(goalTitle(r.goal))}</span><span class="goal-mini-pct">${pct}%</span></div>
            <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
            <div class="goal-mini-line"><span><strong>${brl(r.net)}</strong> de ${brl(r.meta)}</span><span>${sub}</span></div>
            ${goalTodayLine(r)}
        </div>`;
    }).join('') + `<div class="goal-more"><button type="button" class="link-btn" data-goto-goals>${list.length > shown.length ? `Ver todas (${list.length})` : 'Ver detalhes'}</button></div>`;
}

function renderGoals() {
    if (!state.data) return;
    const results = goalResults();
    $('goals-empty').hidden = results.length > 0;

    const open = results.filter(r => r.status === 'active' || r.status === 'scheduled');
    const closed = results.filter(r => r.status === 'done' || r.status === 'expired');
    let html = open.map(goalCard).join('');
    if (closed.length) {
        html += `<h2 class="subhead goals-section-title">Encerradas e concluídas</h2>` + closed.map(goalCard).join('');
    }
    $('goals-list').innerHTML = html;
}

function goalCard(r) {
    const g = r.goal;
    const pct = Math.round(r.progress * 100);
    const s = settings();
    const workDaysLabel = g.weekdays.length === 7 ? 'todos os dias'
        : g.weekdays.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => WEEKDAYS_SHORT[d]).join(', ');

    let details = '';
    if (r.status === 'active' || r.status === 'scheduled') {
        const lucroOk = r.kmPorDia > 0;
        details = `
            <div class="stat-grid">
                <div class="stat"><span class="stat-label">Líquido por dia</span><span class="stat-value big">${brl(r.porDia)}</span><span class="stat-sub">${plural(r.diasRestantes, 'dia de trabalho', 'dias de trabalho')}</span></div>
                <div class="stat"><span class="stat-label">Falta</span><span class="stat-value">${brl(r.falta)}</span><span class="stat-sub">${plural(r.calendarDaysLeft, 'dia', 'dias')} no calendário</span></div>
                ${lucroOk ? `
                <div class="stat"><span class="stat-label">Faturar por dia</span><span class="stat-value">${brl(r.brutoPorDia)}</span><span class="stat-sub">bruto estimado</span></div>
                <div class="stat"><span class="stat-label">Rodar por dia</span><span class="stat-value">≈ ${fmt(r.kmPorDia, 0)} km</span><span class="stat-sub">a ${brl(L.num(s.mediaPagamentoKm))}/km</span></div>` : ''}
            </div>
            ${r.status === 'scheduled' ? `<p class="goal-status">Começa a contar em ${fullDate(g.startDate)}.</p>` : goalTodayLine(r)}`;
    } else if (r.status === 'done') {
        details = `<p class="goal-status">Meta batida!${r.excedente > 0 ? ` Você passou ${brl(r.excedente)} do objetivo.` : ''}</p>`;
    } else {
        details = `<p class="goal-status">Prazo encerrado. Faltaram ${brl(r.falta)} (${pct}% concluído).</p>`;
    }

    return `
    <article class="card goal-card" data-status="${r.status}">
        <div class="goal-head">
            <div>
                <h2 class="goal-name">${esc(goalTitle(g))}</h2>
                <p class="goal-dates">${fullDate(g.startDate)} até ${fullDate(g.deadline)} · ${esc(workDaysLabel)}</p>
            </div>
            <span class="badge">${pct}%</span>
        </div>
        <p class="goal-amounts"><strong>${brl(r.net)}</strong> de ${brl(r.meta)} líquidos</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${details}
        <div class="goal-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-goal-edit="${esc(g.id)}">Editar</button>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-goal-del="${esc(g.id)}">Excluir</button>
        </div>
    </article>`;
}

function renderGoalWeekdays() {
    // Exibe de segunda a domingo
    $('goal-weekdays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(d => `
        <button type="button" class="chip" data-weekday="${d}" aria-pressed="${state.goalWeekdays.includes(d)}" aria-label="${WEEKDAYS[d]}">${WEEKDAYS_SHORT[d]}</button>
    `).join('');
}

function openGoalDialog(id = null) {
    const g = id ? goals().find(x => x.id === id) : null;
    const today = todayDate();
    state.editingGoal = g ? g.id : null;
    $('goal-dialog-title').textContent = g ? 'Editar meta' : 'Nova meta';
    $('goal-submit').textContent = g ? 'Salvar' : 'Criar meta';
    $('goal-amount').value = g ? moneyInput(L.num(g.amount)) : '';
    $('goal-name').value = g?.name || '';
    $('goal-start').value = g?.startDate || L.toDateKey(today);
    $('goal-deadline').value = g?.deadline || L.toDateKey(L.getMonthRange(today).end);
    state.goalWeekdays = g ? [...g.weekdays] : L.defaultWorkWeekdays(settings());
    renderGoalWeekdays();
    updateGoalPreview();
    $('goal-dialog').showModal();
    if (!g) setTimeout(() => $('goal-amount').focus(), 50);
}

function readGoalForm() {
    return {
        amount: parseDecimal($('goal-amount').value),
        name: $('goal-name').value.trim(),
        startDate: $('goal-start').value,
        deadline: $('goal-deadline').value,
        weekdays: [...state.goalWeekdays]
    };
}

function updateGoalPreview() {
    const f = readGoalForm();
    const el = $('goal-preview');
    if (!(f.amount > 0) || !f.startDate || !f.deadline || !f.weekdays.length) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.remove('warn');

    if (f.deadline < f.startDate) {
        el.classList.add('warn');
        el.innerHTML = '<div>A data final precisa ser depois da data de início.</div>';
        return;
    }
    if (f.deadline < L.toDateKey(todayDate())) {
        el.classList.add('warn');
        el.innerHTML = '<div>A data para bater a meta já passou.</div>';
        return;
    }

    const r = L.goalProgress(f, settings(), state.data.history);
    if (r.status === 'done') {
        el.innerHTML = `<div class="preview-row"><span>Você já fez ${brl(r.net)} nesse período</span><strong>Meta batida</strong></div>`;
        return;
    }
    const rows = [['Você precisa fazer por dia', `${brl(r.porDia)} líquidos`]];
    if (r.brutoPorDia > 0) rows.push(['Faturamento bruto por dia', `≈ ${brl(r.brutoPorDia)}`], ['Rodagem por dia', `≈ ${fmt(r.kmPorDia, 0)} km`]);
    rows.push(['Dias de trabalho até a data', String(r.diasRestantes)]);
    if (r.net !== 0) rows.push(['Já feito no período', brl(r.net)]);
    el.innerHTML = rows.map(([k, v]) => `<div class="preview-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function saveGoal(e) {
    e.preventDefault();
    const f = readGoalForm();
    const fail = (msg, id) => { toast(msg, { type: 'error' }); if (id) $(id).focus(); };
    if (!(f.amount > 0)) return fail('Informe quanto quer fazer de lucro líquido.', 'goal-amount');
    if (!f.startDate) return fail('Informe a data de início.', 'goal-start');
    if (!f.deadline) return fail('Informe até quando quer bater a meta.', 'goal-deadline');
    if (f.deadline < f.startDate) return fail('A data final precisa ser depois da data de início.', 'goal-deadline');
    if (!state.editingGoal && f.deadline < L.toDateKey(todayDate())) return fail('A data para bater a meta já passou.', 'goal-deadline');
    if (!f.weekdays.length) return fail('Escolha pelo menos um dia de trabalho.');

    const existing = state.editingGoal && goals().find(g => g.id === state.editingGoal);
    if (existing) {
        Object.assign(existing, f);
    } else {
        goals().push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...f });
    }
    $('goal-dialog').close();
    markChanged(0);
    toast(existing ? 'Meta atualizada.' : 'Meta criada! Acompanhe o progresso na tela Início.');
    const active = document.querySelector('.screen.active')?.id;
    if (active === 'goals-screen') renderGoals();
    else if (active === 'dashboard-screen') renderGoalWidget();
}

async function deleteGoal(id) {
    const idx = goals().findIndex(g => g.id === id);
    if (idx === -1) return;
    const g = goals()[idx];
    const ok = await confirmDialog({
        title: 'Excluir meta?',
        message: `"${goalTitle(g)}" será removida. Seus ganhos lançados não são afetados.`,
        confirmLabel: 'Excluir',
        danger: true
    });
    if (!ok) return;
    goals().splice(idx, 1);
    markChanged();
    renderGoals();
    toast('Meta excluída.', {
        action: 'Desfazer',
        onAction: () => {
            goals().splice(Math.min(idx, goals().length), 0, g);
            markChanged();
            renderGoals();
        }
    });
}

// ═══════════════════════ Ajustes ═══════════════════════
function renderProfile() {
    if (!state.data) return;
    const s = settings();
    const lucroKm = L.num(s.mediaPagamentoKm) - L.num(s.mediaPrecoCombustivel) / L.num(s.mediaConsumoL);
    const rows = [
        ['Meta líquida mensal', brl(L.num(s.metaLiquidaMensal))],
        ['Dias de trabalho', `${s.diasTrabalhoMes} dias`],
        ['Meta líquida por dia', brl(L.num(s.metaLiquidaMensal) / L.num(s.diasTrabalhoMes))],
        ['Ganho médio por km', brl(L.num(s.mediaPagamentoKm))],
        ['Consumo médio', `${fmt(L.num(s.mediaConsumoL))} km/L`],
        ['Preço do litro', brl(L.num(s.mediaPrecoCombustivel))],
        ['Lucro estimado por km', brl(lucroKm)]
    ];
    $('profile-settings').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('profile-platforms').innerHTML = s.plataformas.map(p => `<span class="chip"><span class="plat-dot" style="--c:${platformColor(p)}"></span>${esc(p)}</span>`).join('');
}

function exportBackup() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `napista-backup-${L.toDateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleLogout() {
    if (hasUnsaved()) {
        const ok = await confirmDialog({
            title: 'Sair sem salvar?',
            message: 'Algumas alterações ainda não foram enviadas ao Google Drive e serão perdidas.',
            confirmLabel: 'Sair mesmo assim',
            danger: true
        });
        if (!ok) return;
    }
    logout();
    clearCache();
    resetSync();
    state.data = null;
    state.fileId = null;
    showScreen('login-screen');
}

async function handleWipe() {
    const ok = await confirmDialog({
        title: 'Apagar todos os dados?',
        message: 'Suas metas e todo o histórico serão apagados do Google Drive permanentemente. Considere baixar um backup antes.',
        confirmLabel: 'Apagar tudo',
        danger: true
    });
    if (!ok) return;
    if (!hasValidToken()) {
        toast('Toque em "Sincronizar" no topo para conectar ao Google e tente de novo.', { type: 'error', duration: 6000 });
        setSync(hasUnsaved() ? 'auth' : 'stale');
        return;
    }

    showLoading('Apagando dados…');
    try {
        clearTimeout(saveTimer);
        if (inflight) await inflight;
        await deleteData(state.fileId);
        resetSync();
        state.fileId = null;
        state.data = L.createDefaultData();
        writeCache();
        state.reportKey = null;
        toast('Dados apagados. Vamos configurar do zero.');
        openSetup();
    } catch (e) {
        console.error(e);
        toast('Não foi possível apagar os dados. Tente novamente.', { type: 'error' });
        showScreen('profile-screen');
    }
}

// ═══════════════════════ Eventos (registrados uma única vez) ═══════════════════════
function bindEvents() {
    // Máscaras e lançamentos do dia (delegação: funciona para inputs criados dinamicamente)
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t.classList.contains('money')) maskMoney(t);
        else if (t.classList.contains('decimal')) maskDecimal(t);
        else if (t.classList.contains('integer')) t.value = t.value.replace(/\D/g, '');

        if (t.classList.contains('day-input')) commitDayForm();
        if (t.closest('#setup-form')) updateSetupPreview();
        if (t.closest('#goal-form')) updateGoalPreview();
    });

    $('btn-login').addEventListener('click', handleLogin);

    // Setup
    $('setup-form').addEventListener('submit', saveSetup);
    $('btn-cancel-setup').addEventListener('click', () => showScreen('profile-screen'));
    $('btn-add-app').addEventListener('click', addCustomPlatform);
    $('setup-other-app').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addCustomPlatform(); }
    });
    $('setup-platforms').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-platform]');
        if (!chip) return;
        const p = chip.dataset.platform;
        const i = state.setupPlatforms.indexOf(p);
        if (i === -1) state.setupPlatforms.push(p); else state.setupPlatforms.splice(i, 1);
        chip.setAttribute('aria-pressed', i === -1);
    });

    // Navegação inferior
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => showScreen(btn.dataset.target));
    });

    // Dashboard
    document.querySelectorAll('#scope-seg .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => setScope(btn.dataset.scope));
    });
    $('btn-prev-date').addEventListener('click', () => navigateDate(-1));
    $('btn-next-date').addEventListener('click', () => navigateDate(1));
    $('btn-today').addEventListener('click', () => setAnchor(todayDate()));
    $('btn-date-picker').addEventListener('click', (e) => {
        if (e.target.id !== 'date-picker') openDatePicker();
    });
    $('date-picker').addEventListener('change', (e) => {
        if (e.target.value) setAnchor(L.parseDateKey(e.target.value));
    });
    $('hero-fix').addEventListener('click', openSetup);

    $('btn-add-expense').addEventListener('click', () => openExpenseDialog());
    $('expense-list').addEventListener('click', (e) => {
        const edit = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]');
        if (edit) openExpenseDialog(Number(edit.dataset.edit));
        if (del) removeExpense(Number(del.dataset.del));
    });
    $('expense-form').addEventListener('submit', saveExpense);
    $('expense-suggestions').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-suggest]');
        if (!chip) return;
        $('expense-desc').value = chip.dataset.suggest;
        $('expense-val').focus();
    });

    // Metas
    $('btn-create-goal').addEventListener('click', () => openGoalDialog());
    $('btn-new-goal').addEventListener('click', () => openGoalDialog());
    $('btn-new-goal-empty').addEventListener('click', () => openGoalDialog());
    $('goal-widget-body').addEventListener('click', (e) => {
        if (e.target.closest('[data-goto-goals]')) showScreen('goals-screen');
    });
    $('goals-list').addEventListener('click', (e) => {
        const edit = e.target.closest('[data-goal-edit]');
        const del = e.target.closest('[data-goal-del]');
        if (edit) openGoalDialog(edit.dataset.goalEdit);
        if (del) deleteGoal(del.dataset.goalDel);
    });
    $('goal-form').addEventListener('submit', saveGoal);
    $('goal-form').addEventListener('change', (e) => {
        if (e.target.type === 'date') updateGoalPreview();
    });
    $('goal-weekdays').addEventListener('click', (e) => {
        const chip = e.target.closest('[data-weekday]');
        if (!chip) return;
        const d = Number(chip.dataset.weekday);
        const i = state.goalWeekdays.indexOf(d);
        if (i === -1) state.goalWeekdays.push(d); else state.goalWeekdays.splice(i, 1);
        chip.setAttribute('aria-pressed', i === -1);
        updateGoalPreview();
    });

    // Relatórios
    document.querySelectorAll('#report-seg .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.reportTab = btn.dataset.tab;
            state.reportKey = null;
            renderReports();
        });
    });
    $('report-list').addEventListener('click', (e) => {
        const row = e.target.closest('[data-group]');
        if (!row) return;
        state.reportKey = row.dataset.group;
        renderReports();
        $('rep-period').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('range-form').addEventListener('submit', (e) => {
        e.preventDefault();
        let start = $('range-start').value;
        let end = $('range-end').value;
        if (!start || !end) { toast('Escolha as duas datas.', { type: 'error' }); return; }
        if (start > end) [start, end] = [end, start];
        state.range = { start, end };
        renderReports();
    });
    $('rep-exp-btn').addEventListener('click', openReportExpenses);

    // Ajustes
    $('btn-edit-goals').addEventListener('click', openSetup);
    $('btn-export').addEventListener('click', exportBackup);
    $('btn-logout').addEventListener('click', handleLogout);
    $('btn-wipe').addEventListener('click', handleWipe);

    // Diálogos: botões [data-close] e clique fora
    document.querySelectorAll('dialog').forEach(dlg => {
        dlg.addEventListener('click', (e) => {
            if (e.target === dlg) dlg.close();
            if (e.target.closest('[data-close]')) dlg.close();
        });
    });

    // Sincronização
    $('sync-pill').addEventListener('click', () => {
        if (!state.data) return;
        if (needsSync() || !hasValidToken()) syncNow(); // dentro do clique: permite renovar o login
        else toast('Tudo salvo no seu Google Drive.');
    });
    // Token expirado com algo para sincronizar: aproveita o primeiro toque num
    // botão para renovar (popup rápido que fecha sozinho), uma vez por abertura.
    document.addEventListener('click', (e) => {
        if (autoRenewTried || !state.data || !isAuthReady() || hasValidToken() || !navigator.onLine) return;
        if (!hasUnsaved()) return;
        const btn = e.target.closest('button');
        if (!btn || btn.id === 'sync-pill' || btn.closest('dialog')) return;
        autoRenewTried = true;
        syncNow();
    }, true);
    window.addEventListener('online', () => { if (needsSync()) syncWithDrive(); });
    window.addEventListener('offline', () => { if (hasUnsaved()) setSync('offline'); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && hasUnsaved() && hasValidToken()) flushSave();
        if (document.visibilityState === 'visible' && state.data) {
            // busca alterações feitas em outro aparelho
            if (hasValidToken() && (hasUnsaved() || Date.now() - lastPull > PULL_INTERVAL_MS)) syncWithDrive();
            // ao voltar ao app num novo dia, atualiza o "hoje"
            if ($('dashboard-screen').classList.contains('active')) { renderDateNav(); renderGoalWidget(); }
        }
    });
}

bindEvents();
boot();
