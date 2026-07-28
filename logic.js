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

    // Lucro Líquido Médio Global (Configurações)
    const custoCombustivelPorKmBase = mediaPrecoCombustivel / mediaConsumoL;
    const lucroLiquidoPorKmBase = mediaPagamentoKm - custoCombustivelPorKmBase;

    if (lucroLiquidoPorKmBase <= 0) {
        return { error: "O custo de combustível médio é maior ou igual ao ganho por KM. Revise suas configurações." };
    }

    const hojeStr = currentDate || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(hojeStr + 'T12:00:00');
    const currentMonth = targetDateObj.getMonth();
    const currentYear = targetDateObj.getFullYear();

    // Filtra o histórico deste mês, EXCLUINDO o dia atual
    const historyThisMonth = history.filter(item => {
        const itemDate = new Date(item.date + 'T12:00:00');
        return itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear && item.date !== hojeStr;
    });

    let ganhosBrutosAnteriores = 0;
    let gastosCombustivelAnteriores = 0;

    // Calcular dias anteriores do mês (já fechados)
    historyThisMonth.forEach(day => {
        let dailyEarn = 0;
        for (let p in day.earnings) { dailyEarn += (parseFloat(day.earnings[p]) || 0); }
        ganhosBrutosAnteriores += dailyEarn;
        
        const consumoUsado = parseFloat(day.consumoL) || mediaConsumoL;
        gastosCombustivelAnteriores += (parseFloat(day.km || 0) / consumoUsado) * mediaPrecoCombustivel;
    });

    const lucroLiquidoAnterior = ganhosBrutosAnteriores - gastosCombustivelAnteriores;
    
    // Lucro que falta para bater a meta no resto do mês (incluindo o dia de hoje)
    const metaLiquidaRestanteMensal = metaLiquidaMensal - lucroLiquidoAnterior;

    // Quantos dias restam no mês para bater a meta (incluindo hoje)
    // dias já trabalhados (histórico) + 1 (hoje)
    let diasTrabalhadosTotal = historyThisMonth.length + 1; 
    let diasRestantes = diasTrabalhoMes - historyThisMonth.length; 
    if (diasRestantes <= 0) diasRestantes = 1; // Proteção matemática

    // A meta líquida alvo estrita para o dia de HOJE
    const metaLiquidaDiariaAlvo = metaLiquidaRestanteMensal / diasRestantes;

    // Ler dados de hoje em tempo real
    let hojeGanhoBruto = 0;
    let hojeKm = 0;
    let hojeConsumo = mediaConsumoL;

    if (currentDayInputs) {
        for (let p in currentDayInputs.earnings) { hojeGanhoBruto += (parseFloat(currentDayInputs.earnings[p]) || 0); }
        hojeKm = parseFloat(currentDayInputs.km) || 0;
        hojeConsumo = parseFloat(currentDayInputs.consumoL) || mediaConsumoL;
    }

    // Calcular eficiência real de HOJE
    const hojeCustoCombustivel = (hojeKm / hojeConsumo) * mediaPrecoCombustivel;
    const hojeLucroLiquido = hojeGanhoBruto - hojeCustoCombustivel;
    
    const hojeMetaLiquidaFaltante = metaLiquidaDiariaAlvo - hojeLucroLiquido;

    if (metaLiquidaRestanteMensal <= 0) {
        return {
            metaAlcancada: true,
            excedenteMensal: Math.abs(metaLiquidaRestanteMensal),
            metaBrutaDiaria: 0,
            kmDiario: 0
        };
    }

    // Se já bateu a meta liquida do dia
    if (hojeMetaLiquidaFaltante <= 0) {
        return {
            metaAlcancada: false,
            metaBrutaDiaria: hojeGanhoBruto, // Faz a barra ficar em 100% exatamente
            kmDiario: 0
        };
    }

    // Calcular as médias atuais do dia para projetar o que falta
    const hojeRendimentoPorKm = (hojeGanhoBruto > 0 && hojeKm > 0) ? (hojeGanhoBruto / hojeKm) : mediaPagamentoKm;
    const hojeCustoPorKm = mediaPrecoCombustivel / hojeConsumo;
    let hojeLucroPorKm = hojeRendimentoPorKm - hojeCustoPorKm;

    // Se o cara está pagando para trabalhar hoje (lucro negativo), 
    // ou ainda não fez nada (rendimento zero), voltamos para a média das configs para ter uma estimativa sã
    if (hojeLucroPorKm <= 0) {
        hojeLucroPorKm = lucroLiquidoPorKmBase;
    }

    // Quanto KM falta rodar HOJE, com base na eficiência de HOJE, para atingir o que falta da meta líquida de HOJE
    const kmFaltanteHoje = hojeMetaLiquidaFaltante / hojeLucroPorKm;
    
    // Quanto de ganho bruto isso representa
    // Usamos o rendimento por km de hoje. Se ele não fez nada, vai usar o mediaPagamentoKm
    let rendimentoProjetadoPorKm = (hojeGanhoBruto > 0 && hojeKm > 0) ? hojeRendimentoPorKm : mediaPagamentoKm;
    const ganhoBrutoFaltanteHoje = kmFaltanteHoje * rendimentoProjetadoPorKm;

    const metaBrutaDiariaFinal = hojeGanhoBruto + ganhoBrutoFaltanteHoje;
    const kmDiarioFinal = hojeKm + kmFaltanteHoje;

    return {
        metaAlcancada: false,
        metaBrutaDiaria: Math.max(0, metaBrutaDiariaFinal),
        kmDiario: Math.max(0, kmDiarioFinal)
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
