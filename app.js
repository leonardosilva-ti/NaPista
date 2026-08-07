import { initAuth, login, logout } from './auth.js';
import { findDataFile, readData, saveData, deleteData } from './drive.js';
import { defaultData, calculateTargets, getDayStats } from './logic.js';

let appData = null;
let fileId = null;
let currentScope = 'day'; // day, week, month
let currentSelectedDate = new Date(); 

// Para reverter à última data selecionada pelo usuário quando voltar ao escopo "day"
let lastUserSelectedDate = null; 

// Lista de Despesas (descrição e valor) temporárias do dia selecionado
let currentExpensesList = [];

// Variáveis de controle de Relatórios
let currentReportTab = 'tab-day';
let currentReportExpenses = []; // Detalhe de gastos do período selecionado em relatório

// Lista global de plataformas pré-cadastradas para seleção
const PRESETS_PLATFORMS = ["Uber", "99 Drive (antigo 99)", "InDrive", "Particular", "Shoppe", "Mercado Livre"];

// Helpers de Fuso Horário e Datas
function getTodayDateString() {
    const d = new Date();
    const str = d.toLocaleString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    return str.split(',')[0];
}

function getSelectedDateString() {
    const yyyy = currentSelectedDate.getFullYear();
    const mm = String(currentSelectedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentSelectedDate.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Helpers para obter início e fim da semana corrente
function getWeekStartEndDates(dateObj) {
    const day = dateObj.getDay(); 
    const diffToMonday = dateObj.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(dateObj);
    monday.setDate(diffToMonday);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    return { monday, sunday };
}

// Helpers de Conversão de Moeda (Máscara)
function parseCurrency(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const clearStr = val.toString().replace(/\./g, '').replace(',', '.');
    return parseFloat(clearStr) || 0;
}

function applyCurrencyMask(e) {
    let val = e.target.value.replace(/\D/g, '');
    if (val === '') {
        e.target.value = '';
        updateDashboardTargets();
        return;
    }
    const num = parseInt(val, 10) / 100;
    e.target.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    updateDashboardTargets();
}

// UI Screens
const screens = document.querySelectorAll('.screen');

// Navigation
document.querySelectorAll('.nav-btn, .nav-btn-text').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.target));
});

function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    if (screenId === 'dashboard-screen') initDashboard();
    if (screenId === 'reports-screen') initReports();
}

// Init
window.onload = () => {
    initAuth(onAuthenticated, () => {
        showScreen('login-screen');
    });
};

// Login Flow
document.getElementById('btn-login').addEventListener('click', login);

async function onAuthenticated() {
    showScreen('loading-screen');
    try {
        fileId = await findDataFile();
        if (fileId) {
            appData = await readData(fileId);
            if (!appData || !appData.settings || !appData.settings.plataformas) {
                renderSetup();
                showScreen('setup-screen');
            } else {
                showScreen('dashboard-screen');
            }
        } else {
            appData = JSON.parse(JSON.stringify(defaultData));
            appData.settings.plataformas = [];
            renderSetup();
            showScreen('setup-screen');
        }
    } catch (e) {
        console.error(e);
        alert(`Sua sessão expirou ou houve um problema de conexão. Por favor, autentique-se novamente com o Google para continuar.`);
        showScreen('login-screen');
    }
}

// --- SETUP SCREEN ---
let tempPlatforms = [];

function renderSetup() {
    tempPlatforms = appData.settings.plataformas ? [...appData.settings.plataformas] : [];
    
    document.getElementById('setup-dias').value = appData.settings.diasTrabalhoMes || '';
    document.getElementById('setup-meta').value = appData.settings.metaLiquidaMensal || '';
    document.getElementById('setup-pagamento-km').value = appData.settings.mediaPagamentoKm || '';
    document.getElementById('setup-consumo').value = appData.settings.mediaConsumoL || '';
    document.getElementById('setup-preco-comb').value = appData.settings.mediaPrecoCombustivel || '';
    
    const btnSelect = document.getElementById('btn-select-apps-modal');
    btnSelect.onclick = openAppsSelectionModal;
    
    const btnClose = document.getElementById('btn-close-apps-modal');
    btnClose.onclick = closeAppsSelectionModal;

    const btnAddOther = document.getElementById('btn-modal-add-other');
    btnAddOther.onclick = addOtherPlatformFromModal;

    renderPlatformsList();
}

function renderPlatformsList() {
    const list = document.getElementById('setup-platforms-list');
    list.innerHTML = '';
    
    if (tempPlatforms.length === 0) {
        list.innerHTML = `<span style="font-size:0.9rem; color:var(--text-secondary); font-style:italic;">Nenhum selecionado. Clique no botão acima para adicionar.</span>`;
        return;
    }
    
    tempPlatforms.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = 'platform-tag active';
        div.style.margin = '4px';
        div.innerHTML = `${p} <span style="margin-left:8px; font-weight:bold; color:var(--accent-danger); cursor:pointer;">x</span>`;
        div.onclick = () => {
            tempPlatforms.splice(idx, 1);
            renderPlatformsList();
        };
        list.appendChild(div);
    });
}

function openAppsSelectionModal() {
    const modal = document.getElementById('apps-selection-modal');
    const container = document.getElementById('modal-apps-list');
    container.innerHTML = '';
    
    const allOptions = [...PRESETS_PLATFORMS];
    tempPlatforms.forEach(p => {
        if (!allOptions.includes(p)) {
            allOptions.push(p);
        }
    });

    allOptions.forEach(p => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '10px';
        label.style.fontSize = '1.05rem';
        label.style.cursor = 'pointer';
        label.style.padding = '6px 0';

        const isChecked = tempPlatforms.includes(p);
        label.innerHTML = `
            <input type="checkbox" class="modal-app-checkbox" value="${p}" ${isChecked ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer;">
            <span>${p}</span>
        `;
        container.appendChild(label);
    });

    modal.style.display = 'flex';
}

function addOtherPlatformFromModal() {
    const inp = document.getElementById('modal-other-app-name');
    const value = inp.value.trim();
    if (value) {
        if (!tempPlatforms.includes(value)) {
            tempPlatforms.push(value);
        }
        inp.value = '';
        openAppsSelectionModal();
    }
}

function closeAppsSelectionModal() {
    const modal = document.getElementById('apps-selection-modal');
    
    const checkedBoxes = document.querySelectorAll('.modal-app-checkbox:checked');
    const selected = [];
    checkedBoxes.forEach(box => {
        selected.push(box.value);
    });

    tempPlatforms = selected;
    modal.style.display = 'none';
    renderPlatformsList();
}

document.getElementById('btn-finish-setup').addEventListener('click', async () => {
    const dias = parseInt(document.getElementById('setup-dias').value);
    const meta = parseFloat(document.getElementById('setup-meta').value);
    const pag = parseFloat(document.getElementById('setup-pagamento-km').value);
    const cons = parseFloat(document.getElementById('setup-consumo').value);
    const pre = parseFloat(document.getElementById('setup-preco-comb').value);

    if (!dias || !meta || !pag || !cons || !pre || tempPlatforms.length === 0) {
        alert("Preencha todos os campos e selecione pelo menos uma empresa/aplicativo.");
        return;
    }

    appData.settings = {
        diasTrabalhoMes: dias,
        metaLiquidaMensal: meta,
        mediaPagamentoKm: pag,
        mediaConsumoL: cons,
        mediaPrecoCombustivel: pre,
        plataformas: tempPlatforms
    };

    showScreen('loading-screen');
    try {
        fileId = await saveData(fileId, appData);
        isDashboardInitialized = false;
        showScreen('dashboard-screen');
    } catch (e) {
        console.error(e);
        alert("Erro ao salvar configurações.");
    }
});

// --- DASHBOARD SCREEN ---
let isDashboardInitialized = false;

function initDashboard() {
    if (!isDashboardInitialized) {
        const todayParts = getTodayDateString().split('-');
        currentSelectedDate = new Date(todayParts[0], todayParts[1] - 1, todayParts[2]);
        lastUserSelectedDate = new Date(currentSelectedDate);

        // Eventos do Navegador de Datas
        document.getElementById('btn-prev-date').addEventListener('click', () => navigateDate(-1));
        document.getElementById('btn-next-date').addEventListener('click', () => navigateDate(1));
        
        // Clique na data para abrir picker nativo
        document.getElementById('dash-date-click-area').addEventListener('click', () => {
            if (currentScope === 'day') {
                const picker = document.getElementById('native-date-picker');
                picker.value = getSelectedDateString();
                picker.showPicker();
            } else if (currentScope === 'week') {
                const picker = document.getElementById('native-week-picker');
                picker.showPicker();
            } else if (currentScope === 'month') {
                const picker = document.getElementById('native-month-picker');
                const yyyy = currentSelectedDate.getFullYear();
                const mm = String(currentSelectedDate.getMonth() + 1).padStart(2, '0');
                picker.value = `${yyyy}-${mm}`;
                picker.showPicker();
            }
        });

        // Listeners dos inputs nativos de data
        document.getElementById('native-date-picker').addEventListener('change', (e) => {
            if (e.target.value) {
                const parts = e.target.value.split('-');
                currentSelectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
                lastUserSelectedDate = new Date(currentSelectedDate);
                updateDateDisplay();
                loadDashboardData();
            }
        });

        document.getElementById('native-week-picker').addEventListener('change', (e) => {
            if (e.target.value) {
                const parts = e.target.value.split('-W');
                if (parts.length === 2) {
                    const year = parseInt(parts[0], 10);
                    const week = parseInt(parts[1], 10);
                    const simple = new Date(year, 0, 1 + (week - 1) * 7);
                    const dow = simple.getDay();
                    const ISOweekStart = simple;
                    if (dow <= 4) {
                        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
                    } else {
                        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
                    }
                    currentSelectedDate = ISOweekStart;
                    updateDateDisplay();
                    loadDashboardData();
                }
            }
        });

        document.getElementById('native-month-picker').addEventListener('change', (e) => {
            if (e.target.value) {
                const parts = e.target.value.split('-');
                if (parts.length === 2) {
                    currentSelectedDate = new Date(parts[0], parts[1] - 1, 1);
                    updateDateDisplay();
                    loadDashboardData();
                }
            }
        });

        // Eventos dos Modais de Despesas
        document.getElementById('btn-open-expense-modal').addEventListener('click', () => {
            openExpenseModal();
        });

        document.getElementById('btn-close-expense-modal').addEventListener('click', () => {
            closeExpenseModal();
        });

        document.getElementById('btn-save-expense-modal').addEventListener('click', () => {
            saveExpenseFromModal();
        });

        // Render Platform Inputs just once per settings
        const platContainer = document.getElementById('dash-platform-inputs');
        platContainer.innerHTML = '';
        appData.settings.plataformas.forEach(p => {
            const group = document.createElement('div');
            group.className = 'input-group';
            group.style.marginBottom = '12px';
            group.innerHTML = `
                <label>Ganho ${p} (R$)</label>
                <input type="text" inputmode="numeric" class="plat-input live-calc currency-mask" data-plat="${p}" placeholder="0,00">
            `;
            platContainer.appendChild(group);
        });

        // Listeners for live calc
        document.querySelectorAll('.currency-mask').forEach(inp => {
            inp.addEventListener('input', applyCurrencyMask);
        });
        
        document.getElementById('dash-km').addEventListener('input', updateDashboardTargets);
        document.getElementById('dash-consumo-dia').addEventListener('input', updateDashboardTargets);

        // Scope Tabs
        document.querySelectorAll('.dash-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentScope = btn.dataset.scope;
                
                const lancSection = document.getElementById('dash-lancamentos-section');
                const btnAddExpense = document.getElementById('btn-open-expense-modal');
                if (currentScope === 'day') {
                    lancSection.style.display = 'block';
                    btnAddExpense.style.display = 'block';
                    if (lastUserSelectedDate) {
                        currentSelectedDate = new Date(lastUserSelectedDate);
                    }
                } else {
                    lancSection.style.display = 'none';
                    btnAddExpense.style.display = 'none';
                }
                
                updateDateDisplay();
                loadDashboardData();
            });
        });

        isDashboardInitialized = true;
    }
    
    updateDateDisplay();
    loadDashboardData();
}

const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const mesesAno = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function updateDateDisplay() {
    const displayTop = document.getElementById('dash-date-display-top');
    const displayMain = document.getElementById('dash-date-display');
    const todayStr = getTodayDateString();
    const selectedStr = getSelectedDateString();
    
    if (currentScope === 'day') {
        const d = String(currentSelectedDate.getDate()).padStart(2, '0');
        const m = String(currentSelectedDate.getMonth() + 1).padStart(2, '0');
        const y = currentSelectedDate.getFullYear();
        const nomeDia = diasSemana[currentSelectedDate.getDay()];
        
        if (todayStr === selectedStr) {
            displayTop.style.display = 'block';
            displayTop.textContent = "Hoje";
            displayMain.innerHTML = `${d}/${m}/${y} - ${nomeDia}`;
        } else {
            displayTop.style.display = 'none';
            displayMain.innerHTML = `${d}/${m}/${y} - ${nomeDia}`;
        }
    } 
    else if (currentScope === 'week') {
        displayTop.style.display = 'none';
        
        const { monday, sunday } = getWeekStartEndDates(currentSelectedDate);
        
        const mD = String(monday.getDate()).padStart(2, '0');
        const mM = String(monday.getMonth() + 1).padStart(2, '0');
        const mY = monday.getFullYear();
        
        const sD = String(sunday.getDate()).padStart(2, '0');
        const sM = String(sunday.getMonth() + 1).padStart(2, '0');
        const sY = sunday.getFullYear();
        
        displayMain.innerHTML = `${mD}/${mM}/${mY} - ${sD}/${sM}/${sY}`;
    }
    else if (currentScope === 'month') {
        displayTop.style.display = 'none';
        const nomeMes = mesesAno[currentSelectedDate.getMonth()];
        const y = currentSelectedDate.getFullYear();
        displayMain.innerHTML = `${nomeMes} ${y}`;
    }
}

function navigateDate(direction) {
    if (currentScope === 'day') {
        currentSelectedDate.setDate(currentSelectedDate.getDate() + direction);
        lastUserSelectedDate = new Date(currentSelectedDate);
    } else if (currentScope === 'week') {
        currentSelectedDate.setDate(currentSelectedDate.getDate() + (direction * 7));
    } else if (currentScope === 'month') {
        currentSelectedDate.setMonth(currentSelectedDate.getMonth() + direction);
    }
    updateDateDisplay();
    loadDashboardData();
}

// Controladores do Pop-up/Modal de Gastos
function openExpenseModal(idx = null) {
    const modal = document.getElementById('expense-popup-modal');
    const title = document.getElementById('expense-modal-title');
    const idxInput = document.getElementById('expense-modal-idx');
    const descInput = document.getElementById('expense-modal-desc');
    const valInput = document.getElementById('expense-modal-val');

    if (idx !== null && idx >= 0 && idx < currentExpensesList.length) {
        title.textContent = "Editar Gasto";
        idxInput.value = idx;
        descInput.value = currentExpensesList[idx].desc;
        valInput.value = currentExpensesList[idx].val.toLocaleString('pt-BR', {minimumFractionDigits: 2});
    } else {
        title.textContent = "Adicionar Gasto";
        idxInput.value = "";
        descInput.value = "";
        valInput.value = "";
    }

    modal.style.display = "flex";
}

// Fechamento modal setup
window.closeExpenseModal = () => {
    closeExpenseModal();
};

function closeExpenseModal() {
    const modal = document.getElementById('expense-popup-modal');
    modal.style.display = "none";
}

function saveExpenseFromModal() {
    const idxVal = document.getElementById('expense-modal-idx').value;
    const desc = document.getElementById('expense-modal-desc').value.trim();
    const val = parseCurrency(document.getElementById('expense-modal-val').value);

    if (!desc) {
        alert("Informe a descrição do gasto.");
        return;
    }
    if (val <= 0) {
        alert("Informe um valor de gasto maior que R$ 0,00.");
        return;
    }

    if (idxVal !== "") {
        const idx = parseInt(idxVal, 10);
        currentExpensesList[idx] = { desc, val };
    } else {
        currentExpensesList.push({ desc, val });
    }

    closeExpenseModal();
    renderExpensesList();
    updateDashboardTargets();
}

function renderExpensesList() {
    const listDiv = document.getElementById('dash-expenses-list');
    listDiv.innerHTML = '';
    
    let listToDisplay = [];
    
    if (currentScope === 'day') {
        listToDisplay = currentExpensesList.map((item, idx) => ({ ...item, date: getSelectedDateString(), originalIdx: idx }));
    } else {
        const targetDateObj = new Date(getSelectedDateString() + 'T12:00:00');
        const currentMonth = targetDateObj.getMonth();
        const currentYear = targetDateObj.getFullYear();
        
        let filteredHistory = [];
        if (currentScope === 'month') {
            filteredHistory = appData.history.filter(item => {
                const itemDate = new Date(item.date + 'T12:00:00');
                return itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear;
            });
        } else if (currentScope === 'week') {
            const { monday, sunday } = getWeekStartEndDates(currentSelectedDate);
            const mStr = monday.toISOString().split('T')[0];
            const sStr = sunday.toISOString().split('T')[0];
            filteredHistory = appData.history.filter(item => item.date >= mStr && item.date <= sStr);
        }

        filteredHistory.forEach(day => {
            if (Array.isArray(day.detailedExpenses)) {
                day.detailedExpenses.forEach(exp => {
                    listToDisplay.push({ desc: `${exp.desc} (${day.date.split('-')[2]}/${day.date.split('-')[1]})`, val: exp.val, isReadOnly: true });
                });
            } else if (day.expenses > 0) {
                listToDisplay.push({ desc: `Gastos gerais (${day.date.split('-')[2]}/${day.date.split('-')[1]})`, val: day.expenses, isReadOnly: true });
            }
        });
    }

    if (listToDisplay.length === 0) {
        listDiv.innerHTML = `<span style="font-size:0.85rem; color:var(--text-secondary); font-style:italic; text-align:center; padding: 10px 0;">Nenhum gasto registrado para este período.</span>`;
        return;
    }

    listToDisplay.forEach((exp) => {
        const item = document.createElement('div');
        item.className = 'd-flex justify-between align-center';
        item.style.background = 'rgba(255, 255, 255, 0.03)';
        item.style.padding = '8px 12px';
        item.style.borderRadius = '8px';
        item.style.fontSize = '0.9rem';
        item.style.border = '1px solid rgba(255,255,255,0.02)';
        
        let actionsHtml = '';
        if (!exp.isReadOnly && currentScope === 'day') {
            actionsHtml = `
                <div class="d-flex align-center" style="gap:10px;">
                    <span style="font-weight:600; color:var(--accent-danger)">R$ ${exp.val.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                    <button type="button" class="btn-edit-inline" style="background:none; border:none; color:var(--accent-primary); cursor:pointer; font-weight:600; font-size:0.85rem; padding: 2px 6px;" onclick="window.editExpenseItem(${exp.originalIdx})">Editar</button>
                    <span style="color:var(--accent-danger); font-weight:bold; cursor:pointer; font-size:1.1rem; padding: 0 4px;" onclick="window.removeExpenseItem(${exp.originalIdx})">x</span>
                </div>
            `;
        } else {
            actionsHtml = `<span style="font-weight:600; color:var(--accent-danger)">R$ ${exp.val.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>`;
        }

        item.innerHTML = `
            <span>${exp.desc}</span>
            ${actionsHtml}
        `;
        listDiv.appendChild(item);
    });
}

window.removeExpenseItem = (idx) => {
    currentExpensesList.splice(idx, 1);
    renderExpensesList();
    updateDashboardTargets();
};

window.editExpenseItem = (idx) => {
    openExpenseModal(idx);
};

function loadDashboardData() {
    const selectedDate = getSelectedDateString();
    const dayStats = getDayStats(appData.history, selectedDate);
    
    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = dayStats.earnings[inp.dataset.plat];
        if (val) {
            inp.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        } else {
            inp.value = '';
        }
    });

    document.getElementById('dash-km').value = dayStats.km || '';
    document.getElementById('dash-consumo-dia').value = dayStats.consumoL || '';
    
    if (dayStats.precoL) {
        document.getElementById('dash-preco-litro').value = dayStats.precoL.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    } else {
        document.getElementById('dash-preco-litro').value = '';
    }
    
    const savedDayData = appData.history.find(h => h.date === selectedDate);
    if (savedDayData && Array.isArray(savedDayData.detailedExpenses)) {
        currentExpensesList = [...savedDayData.detailedExpenses];
    } else if (dayStats.expenses > 0) {
        currentExpensesList = [{ desc: 'Gastos gerais', val: dayStats.expenses }];
    } else {
        currentExpensesList = [];
    }

    renderExpensesList();
    updateDashboardTargets();
}

function updateDashboardTargets() {
    const selectedDate = getSelectedDateString();
    
    const currentDayInputs = { earnings: {}, km: 0, consumoL: 0, precoL: 0, expenses: 0, detailedExpenses: [] };
    let currentTotalEarned = 0;
    
    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseCurrency(inp.value);
        if (val > 0) {
            currentDayInputs.earnings[inp.dataset.plat] = val;
            currentTotalEarned += val;
        }
    });
    
    currentDayInputs.km = parseFloat(document.getElementById('dash-km').value) || 0;
    currentDayInputs.consumoL = parseFloat(document.getElementById('dash-consumo-dia').value) || appData.settings.mediaConsumoL;
    
    const pL = parseCurrency(document.getElementById('dash-preco-litro').value);
    currentDayInputs.precoL = pL > 0 ? pL : appData.settings.mediaPrecoCombustivel;
    
    const totalExpenses = currentExpensesList.reduce((acc, item) => acc + item.val, 0);
    currentDayInputs.expenses = totalExpenses;
    currentDayInputs.detailedExpenses = currentExpensesList;
    
    const stats = calculateTargets(currentScope, appData.settings, appData.history, selectedDate, currentDayInputs);
    
    const dashFalta = document.getElementById('dash-falta-hoje');
    const dashMeta = document.getElementById('dash-meta-diaria-info');
    const dashSugerida = document.getElementById('dash-meta-sugerida');
    const dashKm = document.getElementById('dash-km-recomendado');
    const bar = document.getElementById('dash-progress-bar');
    const elBruto = document.getElementById('dash-total-bruto');
    const elLiquido = document.getElementById('dash-total-liquido');

    if (stats.error) {
        dashFalta.textContent = "Erro!";
        dashMeta.textContent = stats.error;
        dashSugerida.style.display = 'none';
        return;
    }

    const bruto = stats.periodoGanhoBruto || 0;
    const liquido = stats.periodoLucroLiquido || 0;
    elBruto.textContent = `R$ ${bruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    elLiquido.textContent = `R$ ${liquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    elLiquido.style.color = liquido >= 0 ? 'var(--accent-secondary)' : 'var(--accent-danger)';

    if (stats.metaAlcancada) {
        dashFalta.textContent = `+ R$ ${stats.excedente.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
        dashFalta.className = 'metric-large';
        dashMeta.textContent = "Parabéns, você bateu a meta! 🎉";
        dashSugerida.style.display = 'none';
        dashKm.textContent = "Uma folga sempre é bem vinda!";
        bar.style.width = '100%';
        bar.style.background = 'var(--accent-secondary)';
    } else {
        const metaOriginal = stats.metaBrutaPeriodoRestante;
        const faltaValor = metaOriginal - currentTotalEarned;
        
        if (faltaValor <= 0) {
            dashFalta.textContent = `+ R$ ${Math.abs(faltaValor).toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
            dashFalta.className = 'metric-large';
            dashMeta.textContent = `Parabéns, você bateu a meta! 🎉`;
            dashSugerida.style.display = 'none';
            bar.style.width = '100%';
            bar.style.background = 'var(--accent-secondary)';
        } else {
            dashFalta.textContent = `R$ ${faltaValor.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
            dashFalta.className = 'metric-large metric-danger';
            
            let label = 'Meta base diária';
            if (currentScope === 'week') label = 'Meta total restante da semana';
            if (currentScope === 'month') label = 'Meta total restante do mês';
            
            dashMeta.textContent = `${label}: R$ ${metaOriginal.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
            
            if (currentScope === 'day') {
                dashSugerida.style.display = 'none';
            } else {
                dashSugerida.style.display = 'block';
                const sLabel = currentScope === 'week' ? 'semana' : 'mês';
                dashSugerida.textContent = `Para bater a meta da ${sLabel}, sugerimos: R$ ${stats.metaBrutaDiariaSugerida.toLocaleString('pt-BR', {minimumFractionDigits:2})} / dia`;
            }
            
            const perc = (currentTotalEarned / metaOriginal) * 100;
            bar.style.width = `${perc}%`;
            bar.style.background = 'var(--accent-primary)';
        }
        dashKm.textContent = `Recomendado rodar: ${stats.kmPeriodoRestante.toFixed(0)} km`;
    }
}

document.getElementById('btn-save-day').addEventListener('click', async () => {
    const selectedDate = getSelectedDateString();
    let dayData = appData.history.find(h => h.date === selectedDate);
    
    if (!dayData) {
        dayData = { date: selectedDate, earnings: {}, km: 0, consumoL: 0, precoL: 0, expenses: 0, detailedExpenses: [] };
        appData.history.push(dayData);
    }

    document.querySelectorAll('.plat-input').forEach(inp => {
        const val = parseCurrency(inp.value);
        if (val > 0) dayData.earnings[inp.dataset.plat] = val;
        else delete dayData.earnings[inp.dataset.plat];
    });

    dayData.km = parseFloat(document.getElementById('dash-km').value) || 0;
    
    const consDia = document.getElementById('dash-consumo-dia').value;
    if (consDia) dayData.consumoL = parseFloat(consDia);
    else delete dayData.consumoL;
    
    const precoDia = parseCurrency(document.getElementById('dash-preco-litro').value);
    if (precoDia > 0) dayData.precoL = precoDia;
    else delete dayData.precoL;
    
    dayData.expenses = currentExpensesList.reduce((acc, item) => acc + item.val, 0);
    dayData.detailedExpenses = [...currentExpensesList];

    document.getElementById('btn-save-day').textContent = "Salvando...";
    try {
        fileId = await saveData(fileId, appData);
        document.getElementById('btn-save-day').textContent = "Salvo!";
        setTimeout(() => { document.getElementById('btn-save-day').textContent = "Salvar Ganhos e Consumo"; }, 2000);
        updateDashboardTargets();
    } catch(e) {
        alert("Erro ao salvar.");
        document.getElementById('btn-save-day').textContent = "Salvar Ganhos e Consumo";
    }
});

// --- REPORTS SCREEN ---
function initReports() {
    // Configurar listeners de tabs dos relatórios
    document.querySelectorAll('.report-tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.report-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentReportTab = btn.dataset.tab;
            
            const customPeriodSection = document.getElementById('report-custom-period');
            if (currentReportTab === 'tab-other') {
                customPeriodSection.style.display = 'block';
            } else {
                customPeriodSection.style.display = 'none';
            }
            
            renderReports(currentReportTab);
        };
    });

    document.getElementById('btn-apply-custom-period').onclick = () => {
        renderReports('tab-other');
    };

    document.getElementById('rep-stat-gastos-btn').onclick = () => {
        openReportExpensesModal();
    };

    document.getElementById('btn-close-report-expenses-modal').onclick = () => {
        document.getElementById('report-expenses-modal').style.display = 'none';
    };

    renderReports(currentReportTab);
}

function openReportExpensesModal() {
    const modal = document.getElementById('report-expenses-modal');
    const container = document.getElementById('report-expenses-modal-list');
    container.innerHTML = '';

    if (currentReportExpenses.length === 0) {
        container.innerHTML = '<p class="text-center" style="font-size:0.9rem; color:var(--text-secondary);">Nenhum gasto extra neste período.</p>';
    } else {
        currentReportExpenses.forEach(exp => {
            const div = document.createElement('div');
            div.className = 'd-flex justify-between align-center';
            div.style.background = 'rgba(255,255,255,0.03)';
            div.style.padding = '8px 12px';
            div.style.borderRadius = '6px';
            div.style.fontSize = '0.9rem';
            div.innerHTML = `
                <span>${exp.desc} <small style="color:var(--text-secondary)">(${exp.date})</small></span>
                <span style="font-weight:600; color:var(--accent-danger)">R$ ${exp.val.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
            `;
            container.appendChild(div);
        });
    }

    modal.style.display = 'flex';
}

function renderReports(tabId) {
    const listTitle = document.getElementById('report-list-title');
    const content = document.getElementById('report-content');
    
    // Obter plataformas ativas do perfil do usuário para o gráfico
    const platforms = appData.settings.plataformas || [];
    
    // Resetar Estatísticas do período
    document.getElementById('rep-stat-km').textContent = '0.0 km';
    document.getElementById('rep-stat-consumo').textContent = '0.0 km/L';
    document.getElementById('rep-stat-combustivel').textContent = 'R$ 0,00';
    document.getElementById('rep-stat-custo-km').textContent = 'R$ 0,00';
    document.getElementById('rep-stat-gastos').textContent = 'R$ 0,00 ➔';
    
    currentReportExpenses = [];

    // Por padrão o gráfico vem zerado (valores zerados por plataforma)
    drawReportChart(platforms, {});

    if (!appData.history || appData.history.length === 0) {
        content.innerHTML = '<p class="text-center" style="padding:20px 0;">Nenhum dado registrado ainda.</p>';
        listTitle.textContent = "Nenhum dado";
        return;
    }

    let itemsToRender = []; // Dias, semanas ou meses para a lista do período

    if (tabId === 'tab-day') {
        listTitle.textContent = "Lançamentos de Dias Recentes";
        itemsToRender = [...appData.history].sort((a,b) => new Date(b.date) - new Date(a.date));
        
        let html = '';
        itemsToRender.forEach(h => {
            let bruto = 0;
            for(let k in h.earnings) bruto += (parseFloat(h.earnings[k])||0);
            
            // Calcular líquido
            const km = parseFloat(h.km) || 0;
            const consumo = parseFloat(h.consumoL) || appData.settings.mediaConsumoL;
            const precoL = parseFloat(h.precoL) || appData.settings.mediaPrecoCombustivel;
            const custoComb = (km / consumo) * precoL;
            const gastosExtras = parseFloat(h.expenses) || 0;
            const liquido = bruto - custoComb - gastosExtras;

            // Formatação do dia
            const parts = h.date.split('-');
            const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;

            html += `
                <div class="report-item-row" data-date="${h.date}" style="border-bottom: 1px solid var(--border-color); padding: 12px 6px; cursor:pointer; transition:background 0.2s;">
                    <div class="d-flex justify-between">
                        <strong>${formattedDate}</strong>
                        <div>
                            <span style="color:var(--text-primary); font-weight:bold; margin-right:12px;">Bruto: R$ ${bruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            <span style="color:var(--accent-secondary); font-weight:bold;">Líq: R$ ${liquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        content.innerHTML = html;

        // Ao clicar no item, preenche as estatísticas e gráfico
        document.querySelectorAll('.report-item-row').forEach(row => {
            row.onclick = () => {
                document.querySelectorAll('.report-item-row').forEach(r => r.style.background = 'none');
                row.style.background = 'rgba(59, 130, 246, 0.15)';
                const dateStr = row.dataset.date;
                const found = appData.history.find(h => h.date === dateStr);
                if (found) {
                    processPeriodData([found]);
                }
            };
        });

    } 
    else if (tabId === 'tab-week') {
        listTitle.textContent = "Lançamentos de Semanas";
        // Agrupar histórico por semanas
        const weeksMap = {};
        appData.history.forEach(h => {
            const dateObj = new Date(h.date + 'T12:00:00');
            const { monday, sunday } = getWeekStartEndDates(dateObj);
            const key = `${monday.toISOString().split('T')[0]}_${sunday.toISOString().split('T')[0]}`;
            if (!weeksMap[key]) weeksMap[key] = [];
            weeksMap[key].push(h);
        });

        const sortedWeekKeys = Object.keys(weeksMap).sort((a,b) => new Date(b.split('_')[0]) - new Date(a.split('_')[0]));
        
        let html = '';
        sortedWeekKeys.forEach(key => {
            const days = weeksMap[key];
            let bruto = 0;
            let liquido = 0;
            
            days.forEach(h => {
                let dayBruto = 0;
                for(let k in h.earnings) dayBruto += (parseFloat(h.earnings[k])||0);
                bruto += dayBruto;

                const km = parseFloat(h.km) || 0;
                const consumo = parseFloat(h.consumoL) || appData.settings.mediaConsumoL;
                const precoL = parseFloat(h.precoL) || appData.settings.mediaPrecoCombustivel;
                const custoComb = (km / consumo) * precoL;
                const gastosExtras = parseFloat(h.expenses) || 0;
                liquido += (dayBruto - custoComb - gastosExtras);
            });

            const partsStart = key.split('_')[0].split('-');
            const partsEnd = key.split('_')[1].split('-');
            const formattedRange = `${partsStart[2]}/${partsStart[1]} a ${partsEnd[2]}/${partsEnd[1]}`;

            html += `
                <div class="report-item-row" data-week-key="${key}" style="border-bottom: 1px solid var(--border-color); padding: 12px 6px; cursor:pointer; transition:background 0.2s;">
                    <div class="d-flex justify-between">
                        <strong>Semana ${formattedRange}</strong>
                        <div>
                            <span style="color:var(--text-primary); font-weight:bold; margin-right:12px;">Bruto: R$ ${bruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            <span style="color:var(--accent-secondary); font-weight:bold;">Líq: R$ ${liquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        content.innerHTML = html;

        document.querySelectorAll('.report-item-row').forEach(row => {
            row.onclick = () => {
                document.querySelectorAll('.report-item-row').forEach(r => r.style.background = 'none');
                row.style.background = 'rgba(59, 130, 246, 0.15)';
                const key = row.dataset.weekKey;
                const days = weeksMap[key];
                if (days) {
                    processPeriodData(days);
                }
            };
        });
    } 
    else if (tabId === 'tab-month') {
        listTitle.textContent = "Lançamentos de Meses";
        // Agrupar histórico por meses
        const monthsMap = {};
        appData.history.forEach(h => {
            const parts = h.date.split('-');
            const key = `${parts[0]}-${parts[1]}`; // YYYY-MM
            if (!monthsMap[key]) monthsMap[key] = [];
            monthsMap[key].push(h);
        });

        const sortedMonthKeys = Object.keys(monthsMap).sort((a,b) => new Date(b + '-01') - new Date(a + '-01'));

        let html = '';
        sortedMonthKeys.forEach(key => {
            const days = monthsMap[key];
            let bruto = 0;
            let liquido = 0;
            
            days.forEach(h => {
                let dayBruto = 0;
                for(let k in h.earnings) dayBruto += (parseFloat(h.earnings[k])||0);
                bruto += dayBruto;

                const km = parseFloat(h.km) || 0;
                const consumo = parseFloat(h.consumoL) || appData.settings.mediaConsumoL;
                const precoL = parseFloat(h.precoL) || appData.settings.mediaPrecoCombustivel;
                const custoComb = (km / consumo) * precoL;
                const gastosExtras = parseFloat(h.expenses) || 0;
                liquido += (dayBruto - custoComb - gastosExtras);
            });

            const parts = key.split('-');
            const nameMonth = mesesAno[parseInt(parts[1], 10) - 1];

            html += `
                <div class="report-item-row" data-month-key="${key}" style="border-bottom: 1px solid var(--border-color); padding: 12px 6px; cursor:pointer; transition:background 0.2s;">
                    <div class="d-flex justify-between">
                        <strong>${nameMonth} / ${parts[0]}</strong>
                        <div>
                            <span style="color:var(--text-primary); font-weight:bold; margin-right:12px;">Bruto: R$ ${bruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            <span style="color:var(--accent-secondary); font-weight:bold;">Líq: R$ ${liquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        content.innerHTML = html;

        document.querySelectorAll('.report-item-row').forEach(row => {
            row.onclick = () => {
                document.querySelectorAll('.report-item-row').forEach(r => r.style.background = 'none');
                row.style.background = 'rgba(59, 130, 246, 0.15)';
                const key = row.dataset.monthKey;
                const days = monthsMap[key];
                if (days) {
                    processPeriodData(days);
                }
            };
        });
    } 
    else if (tabId === 'tab-other') {
        listTitle.textContent = "Filtrar período customizado";
        content.innerHTML = '<p class="text-center" style="padding:20px 0;">Preencha a data início e fim acima e clique em Filtrar Período.</p>';
        
        const startVal = document.getElementById('report-start-date').value;
        const endVal = document.getElementById('report-end-date').value;

        if (startVal && endVal) {
            const filteredDays = appData.history.filter(h => h.date >= startVal && h.date <= endVal);
            if (filteredDays.length === 0) {
                content.innerHTML = '<p class="text-center" style="padding:20px 0;">Nenhum dado encontrado no intervalo selecionado.</p>';
                return;
            }

            listTitle.textContent = `Lançamentos de ${startVal.split('-')[2]}/${startVal.split('-')[1]} até ${endVal.split('-')[2]}/${endVal.split('-')[1]}`;
            
            // Processa de imediato os dados do período customizado filtrado
            processPeriodData(filteredDays);

            let html = '';
            filteredDays.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(h => {
                let bruto = 0;
                for(let k in h.earnings) bruto += (parseFloat(h.earnings[k])||0);
                
                const km = parseFloat(h.km) || 0;
                const consumo = parseFloat(h.consumoL) || appData.settings.mediaConsumoL;
                const precoL = parseFloat(h.precoL) || appData.settings.mediaPrecoCombustivel;
                const custoComb = (km / consumo) * precoL;
                const gastosExtras = parseFloat(h.expenses) || 0;
                const liquido = bruto - custoComb - gastosExtras;

                const parts = h.date.split('-');
                const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;

                html += `
                    <div style="border-bottom: 1px solid var(--border-color); padding: 12px 6px;">
                        <div class="d-flex justify-between">
                            <strong>${formattedDate}</strong>
                            <div>
                                <span style="color:var(--text-primary); font-weight:bold; margin-right:12px;">Bruto: R$ ${bruto.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                                <span style="color:var(--accent-secondary); font-weight:bold;">Líq: R$ ${liquido.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            content.innerHTML = html;
        }
    }
}

// Processa as estatísticas e os valores por app de um conjunto de dias selecionado
function processPeriodData(daysList) {
    const platforms = appData.settings.plataformas || [];
    const appTotals = {};
    platforms.forEach(p => appTotals[p] = 0);

    let totalKm = 0;
    let sumConsumo = 0;
    let sumPrecoL = 0;
    let countConsumo = 0;
    let countPrecoL = 0;
    let totalGastosExtras = 0;
    
    currentReportExpenses = [];

    daysList.forEach(day => {
        // Ganhos
        for (let p in day.earnings) {
            if (appTotals[p] !== undefined) {
                appTotals[p] += parseFloat(day.earnings[p]) || 0;
            }
        }

        // Km Rodado
        totalKm += parseFloat(day.km) || 0;

        // Consumo Automóvel
        if (day.consumoL) {
            sumConsumo += parseFloat(day.consumoL);
            countConsumo++;
        }
        
        // Preço Combustível
        if (day.precoL) {
            sumPrecoL += parseFloat(day.precoL);
            countPrecoL++;
        }

        // Gastos Extras
        const dayExpenseVal = parseFloat(day.expenses) || 0;
        totalGastosExtras += dayExpenseVal;

        if (Array.isArray(day.detailedExpenses)) {
            day.detailedExpenses.forEach(exp => {
                currentReportExpenses.push({ desc: exp.desc, val: exp.val, date: day.date.split('-')[2] + '/' + day.date.split('-')[1] });
            });
        } else if (dayExpenseVal > 0) {
            currentReportExpenses.push({ desc: 'Gastos Gerais', val: dayExpenseVal, date: day.date.split('-')[2] + '/' + day.date.split('-')[1] });
        }
    });

    const mediaConsumo = countConsumo > 0 ? (sumConsumo / countConsumo) : appData.settings.mediaConsumoL;
    const mediaPrecoL = countPrecoL > 0 ? (sumPrecoL / countPrecoL) : appData.settings.mediaPrecoCombustivel;
    const custoCombustivelPorKm = mediaPrecoL / mediaConsumo;

    // Atualizar UI das Estatísticas
    document.getElementById('rep-stat-km').textContent = `${totalKm.toFixed(1)} km`;
    document.getElementById('rep-stat-consumo').textContent = `${mediaConsumo.toFixed(1)} km/L`;
    document.getElementById('rep-stat-combustivel').textContent = `R$ ${mediaPrecoL.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    document.getElementById('rep-stat-custo-km').textContent = `R$ ${custoCombustivelPorKm.toLocaleString('pt-BR', {minimumFractionDigits:2})}`;
    document.getElementById('rep-stat-gastos').textContent = `R$ ${totalGastosExtras.toLocaleString('pt-BR', {minimumFractionDigits:2})} ➔`;

    // Desenhar Gráfico
    drawReportChart(platforms, appTotals);
}

// Desenha o gráfico de barras
function drawReportChart(platforms, appTotals) {
    const container = document.getElementById('report-chart-container');
    container.innerHTML = '';

    // Encontrar maior valor para normalizar altura das torres (máximo 100%)
    let maxVal = 0;
    platforms.forEach(p => {
        const val = appTotals[p] || 0;
        if (val > maxVal) maxVal = val;
    });

    if (maxVal === 0) maxVal = 100; // Evita divisão por zero

    platforms.forEach(p => {
        const val = appTotals[p] || 0;
        const pctHeight = (val / maxVal) * 100;

        const colDiv = document.createElement('div');
        colDiv.style.display = 'flex';
        colDiv.style.flexDirection = 'column';
        colDiv.style.alignItems = 'center';
        colDiv.style.width = '14%';
        colDiv.style.height = '100%';
        colDiv.style.justifyContent = 'flex-end';

        colDiv.innerHTML = `
            <span style="font-size:0.75rem; font-weight:bold; color:var(--accent-secondary); margin-bottom:4px; white-space:nowrap;">R$ ${val.toFixed(0)}</span>
            <div style="width:70%; height:${pctHeight.toFixed(0)}%; background:linear-gradient(180deg, var(--accent-primary) 0%, rgba(59,130,246,0.3) 100%); border-radius:6px 6px 0 0; transition:height 0.4s ease; box-shadow: var(--glow-primary);"></div>
            <span style="font-size:0.7rem; color:var(--text-secondary); margin-top:8px; text-align:center; overflow:hidden; text-overflow:ellipsis; width:100%; white-space:nowrap;" title="${p}">${p.split(' ')[0]}</span>
        `;
        container.appendChild(colDiv);
    });
}

// --- PROFILE SCREEN ---
document.getElementById('btn-reconfig').addEventListener('click', () => {
    isDashboardInitialized = false; 
    renderSetup();
    showScreen('setup-screen');
});

document.getElementById('btn-wipe-data').addEventListener('click', async () => {
    if (confirm("TEM CERTEZA? Isso apagará todos os seus dados do Google Drive permanentemente.")) {
        showScreen('loading-screen');
        try {
            await deleteData(fileId);
            fileId = null;
            appData = null;
            isDashboardInitialized = false;
            logout();
            showScreen('login-screen');
        } catch(e) {
            alert("Erro ao apagar os dados.");
            showScreen('profile-screen');
        }
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    appData = null;
    fileId = null;
    isDashboardInitialized = false;
    showScreen('login-screen');
});
