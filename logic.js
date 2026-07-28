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
    history: [] // [{ date: 'YYYY-MM-DD', earnings: {Uber: 10}, km: 100, refuel: 50, expenses: 20 }]
};

// Funções de Cálculo

export function calculateDailyTargets(settings, history = []) {
    const { 
        diasTrabalhoMes, 
        metaLiquidaMensal, 
        mediaPagamentoKm, 
        mediaConsumoL, 
        mediaPrecoCombustivel 
    } = settings;

    // Custo de combustível por KM rodado
    const custoCombustivelPorKm = mediaPrecoCombustivel / mediaConsumoL;
    
    // Lucro líquido real por KM rodado
    const lucroLiquidoPorKm = mediaPagamentoKm - custoCombustivelPorKm;

    if (lucroLiquidoPorKm <= 0) {
        return { error: "O custo de combustível é maior ou igual ao ganho por KM. Meta impossível." };
    }

    // Calcular o total de KM que precisa rodar no mês para bater a meta
    const kmTotalMensal = metaLiquidaMensal / lucroLiquidoPorKm;
    
    // Valor bruto total que precisa fazer no mês
    const metaBrutaMensal = kmTotalMensal * mediaPagamentoKm;

    // Pegar o mês atual para filtrar histórico
    const hoje = new Date();
    const currentMonth = hoje.getMonth();
    const currentYear = hoje.getFullYear();

    const historyThisMonth = history.filter(item => {
        const itemDate = new Date(item.date + 'T12:00:00'); // Evitar timezone issues
        return itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear;
    });

    let ganhosBrutosRealizados = 0;
    let kmRodadoRealizado = 0;
    let gastosCombustivelEstimadoRealizado = 0;

    const diasTrabalhados = historyThisMonth.length;
    // Opcional: checar se hoje já foi trabalhado para não contar hoje duas vezes nos dias faltantes
    const hojeStr = hoje.toISOString().split('T')[0];
    const trabalhouHoje = historyThisMonth.find(h => h.date === hojeStr);

    historyThisMonth.forEach(day => {
        let dailyEarn = 0;
        for (let p in day.earnings) { dailyEarn += (parseFloat(day.earnings[p]) || 0); }
        ganhosBrutosRealizados += dailyEarn;
        kmRodadoRealizado += parseFloat(day.km || 0);
        
        // Gasto de combustível baseado no KM real do dia
        gastosCombustivelEstimadoRealizado += (parseFloat(day.km || 0) / mediaConsumoL) * mediaPrecoCombustivel;
    });

    const lucroLiquidoRealizado = ganhosBrutosRealizados - gastosCombustivelEstimadoRealizado;
    
    const metaLiquidaRestante = metaLiquidaMensal - lucroLiquidoRealizado;
    
    let diasRestantes = diasTrabalhoMes - diasTrabalhados;
    if (diasRestantes <= 0) diasRestantes = 1; // Para evitar divisão por zero se o cara trabalhar mais dias

    // Se já bateu a meta do mês inteiro
    if (metaLiquidaRestante <= 0) {
        return {
            metaAlcancada: true,
            excedenteMensal: Math.abs(metaLiquidaRestante),
            metaBrutaDiaria: 0,
            kmDiario: 0
        };
    }

    // Calcula quanto falta bater bruto pros dias restantes
    const kmTotalRestante = metaLiquidaRestante / lucroLiquidoPorKm;
    const metaBrutaRestante = kmTotalRestante * mediaPagamentoKm;

    const metaBrutaDiaria = metaBrutaRestante / diasRestantes;
    const kmDiario = kmTotalRestante / diasRestantes;

    return {
        metaAlcancada: false,
        metaBrutaDiaria: Math.max(0, metaBrutaDiaria),
        kmDiario: Math.max(0, kmDiario),
        diasTrabalhados,
        diasRestantes,
        ganhosBrutosRealizados,
        lucroLiquidoRealizado
    };
}

export function getTodayStats(history) {
    const hojeStr = new Date().toISOString().split('T')[0];
    const todayData = history.find(h => h.date === hojeStr);
    
    if (!todayData) {
        return {
            totalEarned: 0,
            km: 0,
            expenses: 0,
            earnings: {}
        };
    }

    let totalEarned = 0;
    for (let p in todayData.earnings) { totalEarned += (parseFloat(todayData.earnings[p]) || 0); }

    return {
        totalEarned,
        km: parseFloat(todayData.km || 0),
        expenses: parseFloat(todayData.expenses || 0) + parseFloat(todayData.refuel || 0), // refuel doesn't affect target directly, but is tracked
        earnings: todayData.earnings
    };
}
