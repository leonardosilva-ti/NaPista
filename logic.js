// Estrutura de dados padrão
export const defaultData = {
    settings: {
        diasTrabalhoMes: 0,
        metaLiquidaMensal: 0,
        mediaPagamentoKm: 0,
        mediaConsumoL: 0,
        mediaPrecoCombustivel: 0,
        plataformas: ["Uber", "99", "InDrive", "Particular"]
    },
    history: []
};

// Helpers para Datas
function getWeekStartEnd(dateStr) {
    const date = new Date(dateStr + 'T12:00:00');
    const day = date.getDay(); // 0 (Sun) to 6 (Sat)
    const diffToMonday = date.getDate() - day + (day === 0 ? -6 : 1);
    
    const start = new Date(date);
    start.setDate(diffToMonday);
    
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    
    return { 
        start: start.toISOString().split('T')[0], 
        end: end.toISOString().split('T')[0] 
    };
}

export function calculateTargets(scope = 'day', settings, history = [], currentDate = null, currentDayInputs = null) {
    const { 
        diasTrabalhoMes, 
        metaLiquidaMensal, 
        mediaPagamentoKm, 
        mediaConsumoL, 
        mediaPrecoCombustivel 
    } = settings;

    // Constantes e Metas Base (Perfil)
    const custoCombustivelPorKmBase = mediaPrecoCombustivel / mediaConsumoL;
    const lucroLiquidoPorKmBase = mediaPagamentoKm - custoCombustivelPorKmBase;
    
    if (lucroLiquidoPorKmBase <= 0) {
        return { error: "O custo de combustível médio é maior ou igual ao ganho por KM. Revise suas configurações." };
    }

    const metaLiquidaDiariaBase = metaLiquidaMensal / diasTrabalhoMes;
    // Semanas médias no mês: 4.33
    const metaLiquidaSemanalBase = metaLiquidaMensal / 4.33; 

    const hojeStr = currentDate || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(hojeStr + 'T12:00:00');
    const currentMonth = targetDateObj.getMonth();
    const currentYear = targetDateObj.getFullYear();
    const { start: weekStart, end: weekEnd } = getWeekStartEnd(hojeStr);

    // Filtra histórico conforme o escopo (excluindo hoje)
    let historyToConsider = [];
    if (scope === 'month') {
        historyToConsider = history.filter(item => {
            const itemDate = new Date(item.date + 'T12:00:00');
            return itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear && item.date !== hojeStr;
        });
    } else if (scope === 'week') {
        historyToConsider = history.filter(item => {
            return item.date >= weekStart && item.date <= weekEnd && item.date !== hojeStr;
        });
    }
    // No escopo 'day', o historyToConsider fica vazio intencionalmente.

    let ganhosBrutosAnteriores = 0;
    let gastosCombustivelAnteriores = 0;
    let gastosExtrasAnteriores = 0;

    historyToConsider.forEach(day => {
        let dailyEarn = 0;
        for (let p in day.earnings) { dailyEarn += (parseFloat(day.earnings[p]) || 0); }
        ganhosBrutosAnteriores += dailyEarn;
        
        const consumoUsado = parseFloat(day.consumoL) || mediaConsumoL;
        const precoUsado = parseFloat(day.precoL) || mediaPrecoCombustivel;
        
        gastosCombustivelAnteriores += (parseFloat(day.km || 0) / consumoUsado) * precoUsado;
        gastosExtrasAnteriores += parseFloat(day.expenses || 0);
    });

    // Lucro Liquido Real = Ganho Bruto - Combustivel - Alimentação/Gastos Extras
    const lucroLiquidoAnterior = ganhosBrutosAnteriores - gastosCombustivelAnteriores - gastosExtrasAnteriores;
    
    // Alvo de Lucro Liquido do Periodo Analisado
    let metaLiquidaPeriodoTotal = metaLiquidaDiariaBase;
    let diasTotaisPeriodo = 1;
    let diasTrabalhadosTotal = 1;
    let diasRestantesPeriodo = 1;

    if (scope === 'month') {
        metaLiquidaPeriodoTotal = metaLiquidaMensal;
        diasTotaisPeriodo = diasTrabalhoMes;
        diasTrabalhadosTotal = historyToConsider.length + 1;
        diasRestantesPeriodo = diasTotaisPeriodo - historyToConsider.length;
    } else if (scope === 'week') {
        metaLiquidaPeriodoTotal = metaLiquidaSemanalBase;
        // Se trabalha 20 dias, trabalha ~5 na semana.
        diasTotaisPeriodo = Math.round(diasTrabalhoMes / 4.33); 
        if(diasTotaisPeriodo < 1) diasTotaisPeriodo = 1;
        diasTrabalhadosTotal = historyToConsider.length + 1;
        diasRestantesPeriodo = diasTotaisPeriodo - historyToConsider.length;
    }

    if (diasRestantesPeriodo <= 0) diasRestantesPeriodo = 1; // Proteção

    // Se já bateu no período anterior, mas estamos em Month ou Week, a meta de hoje pode cair
    const metaLiquidaRestanteNoPeriodo = metaLiquidaPeriodoTotal - lucroLiquidoAnterior;

    // A meta líquida exata para HOJE, baseada no saldo do período
    let metaLiquidaDiariaAlvo = metaLiquidaRestanteNoPeriodo / diasRestantesPeriodo;
    if (scope === 'day') {
        metaLiquidaDiariaAlvo = metaLiquidaDiariaBase; // Dia não dilui histórico
    }

    // Ler dados de hoje em tempo real
    let hojeGanhoBruto = 0;
    let hojeKm = 0;
    let hojeConsumo = mediaConsumoL;
    let hojePrecoL = mediaPrecoCombustivel;
    let hojeGastosExtras = 0;

    if (currentDayInputs) {
        for (let p in currentDayInputs.earnings) { hojeGanhoBruto += (parseFloat(currentDayInputs.earnings[p]) || 0); }
        hojeKm = parseFloat(currentDayInputs.km) || 0;
        hojeConsumo = parseFloat(currentDayInputs.consumoL) || mediaConsumoL;
        hojePrecoL = parseFloat(currentDayInputs.precoL) || mediaPrecoCombustivel;
        hojeGastosExtras = parseFloat(currentDayInputs.expenses) || 0;
    }

    // Calcular eficiência real de HOJE
    const hojeCustoCombustivel = (hojeKm / hojeConsumo) * hojePrecoL;
    // O lucro liquido de hoje sofre o desconto dos gastos extras
    const hojeLucroLiquido = hojeGanhoBruto - hojeCustoCombustivel - hojeGastosExtras;
    
    // Quanto ainda falta bater do lucro de hoje
    const hojeMetaLiquidaFaltante = metaLiquidaDiariaAlvo - hojeLucroLiquido;

    // Se já bateu a meta macro
    if (metaLiquidaRestanteNoPeriodo <= 0 && (scope === 'week' || scope === 'month')) {
        return {
            metaAlcancada: true,
            excedente: Math.abs(metaLiquidaRestanteNoPeriodo + hojeLucroLiquido), // O que sobrou total
            metaBrutaPeriodoRestante: 0,
            kmPeriodoRestante: 0,
            hojeGanhoBruto,
            hojeKm
        };
    }

    // Se já bateu a meta liquida APENAS do dia
    if (hojeMetaLiquidaFaltante <= 0) {
        return {
            metaAlcancada: true,
            excedente: Math.abs(hojeMetaLiquidaFaltante), // O que sobrou hoje
            metaBrutaPeriodoRestante: 0,
            kmPeriodoRestante: 0,
            hojeGanhoBruto,
            hojeKm
        };
    }

    // Calcular as médias atuais do dia para projetar o que falta
    const hojeRendimentoPorKm = (hojeGanhoBruto > 0 && hojeKm > 0) ? (hojeGanhoBruto / hojeKm) : mediaPagamentoKm;
    const hojeCustoPorKm = hojePrecoL / hojeConsumo;
    let hojeLucroPorKm = hojeRendimentoPorKm - hojeCustoPorKm;

    if (hojeLucroPorKm <= 0) {
        hojeLucroPorKm = lucroLiquidoPorKmBase;
    }

    // Quanto KM falta rodar HOJE
    const kmFaltanteHoje = hojeMetaLiquidaFaltante / hojeLucroPorKm;
    
    let rendimentoProjetadoPorKm = (hojeGanhoBruto > 0 && hojeKm > 0) ? hojeRendimentoPorKm : mediaPagamentoKm;
    const ganhoBrutoFaltanteHoje = kmFaltanteHoje * rendimentoProjetadoPorKm;

    // No dashboard nós mostramos a meta bruta que ele deve bater hoje para o escopo selecionado
    const metaBrutaDiariaFinal = hojeGanhoBruto + ganhoBrutoFaltanteHoje;
    const kmDiarioFinal = hojeKm + kmFaltanteHoje;

    return {
        metaAlcancada: false,
        metaBrutaPeriodoRestante: Math.max(0, metaBrutaDiariaFinal),
        kmPeriodoRestante: Math.max(0, kmDiarioFinal),
        hojeGanhoBruto,
        hojeKm
    };
}

export function getDayStats(history, dateStr) {
    const todayData = history.find(h => h.date === dateStr);
    
    if (!todayData) {
        return {
            totalEarned: 0,
            km: 0,
            consumoL: '',
            precoL: '',
            expenses: 0,
            earnings: {}
        };
    }

    let totalEarned = 0;
    for (let p in todayData.earnings) { totalEarned += (parseFloat(todayData.earnings[p]) || 0); }

    return {
        totalEarned,
        km: parseFloat(todayData.km || 0),
        consumoL: todayData.consumoL ? parseFloat(todayData.consumoL) : '',
        precoL: todayData.precoL ? parseFloat(todayData.precoL) : '',
        expenses: parseFloat(todayData.expenses || 0),
        earnings: todayData.earnings || {}
    };
}
