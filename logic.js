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
    history: [] // [{ date: 'YYYY-MM-DD', earnings: {Uber: 10}, km: 100, consumoL: 10.5, expenses: 20 }]
};

// Funções de Cálculo

export function calculateDailyTargets(settings, history = [], currentDate = null, currentDayInputs = null) {
    const { 
        diasTrabalhoMes, 
        metaLiquidaMensal, 
        mediaPagamentoKm, 
        mediaConsumoL, 
        mediaPrecoCombustivel 
    } = settings;

    // Custo base de combustível
    const custoCombustivelPorKm = mediaPrecoCombustivel / mediaConsumoL;
    const lucroLiquidoPorKm = mediaPagamentoKm - custoCombustivelPorKm;

    if (lucroLiquidoPorKm <= 0) {
        return { error: "O custo de combustível é maior ou igual ao ganho por KM. Meta impossível." };
    }

    const hojeStr = currentDate || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(hojeStr + 'T12:00:00');
    const currentMonth = targetDateObj.getMonth();
    const currentYear = targetDateObj.getFullYear();

    // Filtra o histórico deste mês, excluindo o dia atual sendo visualizado para substituirmos pelos inputs
    const historyThisMonth = history.filter(item => {
        const itemDate = new Date(item.date + 'T12:00:00');
        return itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear && item.date !== hojeStr;
    });

    let ganhosBrutosRealizados = 0;
    let kmRodadoRealizado = 0;
    let gastosCombustivelEstimadoRealizado = 0;

    // Calcular dias anteriores do mês
    historyThisMonth.forEach(day => {
        let dailyEarn = 0;
        for (let p in day.earnings) { dailyEarn += (parseFloat(day.earnings[p]) || 0); }
        ganhosBrutosRealizados += dailyEarn;
        kmRodadoRealizado += parseFloat(day.km || 0);
        
        const consumoUsado = parseFloat(day.consumoL) || mediaConsumoL;
        gastosCombustivelEstimadoRealizado += (parseFloat(day.km || 0) / consumoUsado) * mediaPrecoCombustivel;
    });

    // Injetar os valores do dia atual (inputs ativos) no somatório do mês
    if (currentDayInputs) {
        let currentDayEarn = 0;
        for (let p in currentDayInputs.earnings) { currentDayEarn += (parseFloat(currentDayInputs.earnings[p]) || 0); }
        ganhosBrutosRealizados += currentDayEarn;
        
        const cKm = parseFloat(currentDayInputs.km) || 0;
        kmRodadoRealizado += cKm;
        
        const cConsumo = parseFloat(currentDayInputs.consumoL) || mediaConsumoL;
        gastosCombustivelEstimadoRealizado += (cKm / cConsumo) * mediaPrecoCombustivel;
    }

    const lucroLiquidoRealizado = ganhosBrutosRealizados - gastosCombustivelEstimadoRealizado;
    
    // Lucro que ainda falta para bater a meta mensal
    const metaLiquidaRestante = metaLiquidaMensal - lucroLiquidoRealizado;
    
    // Calcular dias que já foram trabalhados (incluindo hoje)
    let diasTrabalhados = historyThisMonth.length + 1; // +1 do dia sendo preenchido
    let diasRestantes = diasTrabalhoMes - diasTrabalhados;
    
    // Se o cara trabalhou mais dias do que planejou, forçar divisão por 1 para evitar metas diárias infinitas
    if (diasRestantes <= 0) diasRestantes = 1; 

    if (metaLiquidaRestante <= 0) {
        return {
            metaAlcancada: true,
            excedenteMensal: Math.abs(metaLiquidaRestante),
            metaBrutaDiaria: 0,
            kmDiario: 0
        };
    }

    const kmTotalRestante = metaLiquidaRestante / lucroLiquidoPorKm;
    const metaBrutaRestante = kmTotalRestante * mediaPagamentoKm;

    const metaBrutaDiaria = metaBrutaRestante / diasRestantes;
    const kmDiario = kmTotalRestante / diasRestantes;

    return {
        metaAlcancada: false,
        metaBrutaDiaria: Math.max(0, metaBrutaDiaria),
        kmDiario: Math.max(0, kmDiario)
    };
}

export function getDayStats(history, dateStr) {
    const todayData = history.find(h => h.date === dateStr);
    
    if (!todayData) {
        return {
            totalEarned: 0,
            km: 0,
            consumoL: '', // vazio para puxar a média
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
        expenses: parseFloat(todayData.expenses || 0),
        earnings: todayData.earnings || {}
    };
}
