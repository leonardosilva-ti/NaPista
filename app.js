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
    if (screenId === 'reports-screen') renderReports('tab-day');
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
            // No primeiro acesso, garantir que a lista venha vazia para o usuário escolher
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
                
                // Hide/Show Lançamentos e o botão de adicionar despesa (só adiciona no dia atual do lançamento)
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
                    btnAddExpense.style.display = 'none'; // Oculta botão de novo gasto em resumos semanais/mensais
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
    
    // Obter lista a ser exibida com base no escopo
    let listToDisplay = [];
    
    if (currentScope === 'day') {
        listToDisplay = currentExpensesList.map((item, idx) => ({ ...item, date: getSelectedDateString(), originalIdx: idx }));
    } else {
        // Filtrar e agrupar gastos do histórico para semana/mês
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

        // Adicionar também o input temporário de hoje caso coincida com o período visualizado e não esteja salvo
        const selectedDateStr = getSelectedDateString();
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

// Funções expostas no escopo global para acionamento via onclick dos botões da lista
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
    
    // Suportar leitura da nova estrutura de gastos do histórico
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
    
    // Calcula o somatório dos múltiplos gastos
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
document.querySelectorAll('.tab-btn').forEach(btn => {
    if(!btn.classList.contains('dash-tab-btn')){
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn:not(.dash-tab-btn)').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderReports(btn.dataset.tab);
        });
    }
});

function renderReports(tabId) {
    const content = document.getElementById('report-content');
    let html = '';
    
    const history = [...appData.history].sort((a,b) => new Date(b.date) - new Date(a.date));
    
    if (history.length === 0) {
        content.innerHTML = '<p class="text-center">Nenhum dado registrado ainda.</p>';
        return;
    }

    if (tabId === 'tab-day') {
        history.slice(0, 7).forEach(h => {
            let total = 0;
            for(let k in h.earnings) total += (parseFloat(h.earnings[k])||0);
            html += `
                <div style="border-bottom: 1px solid var(--border-color); padding: 10px 0;">
                    <div class="d-flex justify-between">
                        <strong>${h.date}</strong>
                        <span style="color:var(--accent-secondary)">R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">
                        KM: ${h.km} | PreçoL: ${h.precoL ? 'R$'+h.precoL.toLocaleString('pt-BR') : 'Média'} | Gastos: R$ ${h.expenses ? h.expenses.toLocaleString('pt-BR') : '0'}
                    </div>
                </div>
            `;
        });
    } else {
        html = '<p class="text-center">Aguardando implementação avançada de gráficos.</p>';
    }
    
    content.innerHTML = html;
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
