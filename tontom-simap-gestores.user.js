// ==UserScript==
// @name          Tontom-Simap - Gestores
// @namespace     simap-tjpe
// @version      1.2
// @description   Seletor de equipes, Status, Prioridades e Menu de observações padronizadas- último
// @match         https://simap.svc.tjpe.jus.br/*
// @match         https://*.tjpe.jus.br/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      docs.google.com
// @run-at        document-end
// ==/UserScript==
 
(function () {
    'use strict';
    const URL_PLANILHA = "https://docs.google.com/spreadsheets/d/1v4cbLicC3ilOx-cS7PP9pV82y4H6jcS_QsNn32Jcz3s/edit?gid=0#gid=0";
 
GM_addStyle(`
.tag-prioridade {
    display:inline-block;
    padding:2px 6px;
    margin-left:6px;
    font-weight:bold;
    font-size:11px;
    color:#fff !important;
    border-radius:4px;
    text-transform:uppercase;
}
.prio-p1 { background:#ef4444 !important; }
.prio-p2 { background:#f97316 !important; }
.prio-p3 { background:#eab308 !important; color:#000 !important; }
.prio-p4 { background:#3b82f6 !important; }
.prio-p5 { background:#a855f7 !important; }
.prio-p6 { background:#10b981 !important; }
.prio-p7 { background:#6366f1 !important; }
.prio-p8 { background:#ec4899 !important; }
.prio-p9 { background:#64748b !important; }
`);
 
const BANCO_PRIORIDADES = new Map();
 
    let telaProcessosAberta = false;
    let varreduraAtiva = false;
    let varreduraPausada = false;
    let indiceAtualVarredura = 0;
    let abortarVarreduraAtual = false;
 
    const equipes = {
        "Todas": [],
        "Equipe 1": ["ELIANE MARIA SANTOS RODARTE ANDRADE", "FABIO BORGES GONCALVES", "HI MEET SHIUE", "MARIA LUCIANA DA SILVA", "MARCELLE SÁ CARNEIRO MENDONÇA", "MARTA MARIA BARBARA", "MOYSA MARIA DE SOUZA LEAO SALES", "TAYSSA MAYARA PEDERNEIRAS PAZ", "MARIANA PORTO GOMES DE CARVALHO"],
        "Equipe 2": ["MARINA BESSI FERNANDES", "ANA ELIZABETH AGUIAR CAVALCANTI", "ANE VICTOR ALVES CARDOSO", "BLANIA LEUCHTEMBERG DE OLIVEIRA", "DIANA GONCALVES BOTELHO", "ISOLDA MARIA AZEVEDO DE LYRA", "MARIA INEZ MENEZES DOS SANTOS", "SABRINA SERRANO BARBOSA", "SAMARA OLIVEIRA DE MELO", "JULIANA SABRINA CABRAL RODRIGUES"],
        "Equipe 3": ["ADRIANA MINDELO CAVALCANTI DE ALBUQUERQUE", "CARLOS EDUARDO GOMES DE MELO", "EVERSON PAULO DO NASCIMENTO", "LUCIANA TEIXEIRA DE MAGALHAES", "MICHELE ELIAS SANTOS SOUZA", "RAQUEL FERREIRA DOS SANTOS NIPPO", "ROBERTA CORTEZ DE CARVALHO", "SIDNEY PEDROSA DE MELO", "JOAO VICTOR SARAIVA WENCESLAU"],
        "Equipe 4": ["ANA ELISABETE PROCOPIO DE ALMEIDA", "CAROLINA JORDAN", "CLAUDIA LOBO DA COSTA CARVALHO AMORIM", "EUDALIA MARIA ALVES FONSECA", "GESLAINE DA SILVA FERREIRA", "JOSE AUGUSTO BRAGA", "JULIANA DE SOUSA AMORIM", "KAREN SAVANNA BRILHANTE ALVES MIYAKAWA", "LUCIANA CARMONA BOTELHO"],
        "Equipe 5": ["ADALBERTO DA SOLEDADE SILVA FILHO", "JANAINA FERRO DE SOUSA PORFIRIO LIMA", "JULIANA CARNEIRO DA MOTTA", "JULIANA PONTES A DE A LOPES TAVARES", "LIDIA SERRANO BARBOSA SANTOS", "MAYARA SIMONI LAET DE ANDRADE", "PATRICIA VIEIRA DE L ALBUQUERQUE NOVAES", "SIMONE NANES VILELA", "LARISSA NOGUEIRA BESSA"],
        "Equipe 6": ["BERGSON DANTAS DE MOURA BARBOSA", "FERNANDA ALVES DA SILVA", "IAMANDA LEUSE CAMPOS DE LIMA", "ITALO JORGE CAVALCANTI DE A NUNES", "NATALIA MARIA CATÃO VILELA", "ROBERTO FERREIRA DA SILVA", "SILVANA MARIA ROCHA PEREIRA FRAGOSO", "TASSIA REBECA RATIS DA SILVA", "TERCIA VANESSA MATIAS DE OLIVEIRA"],
        "Equipe 7": ["ANA CLAUDIA DE MELO MARQUES LUZ", "CARLOS DE LIMA RIBEIRO JUNIOR", "CHARLES TONY DE OLIVEIRA LIRA", "FRANCIELLE MARIA DA SILVA MACEDO DE ANDRADE", "IRACY CABRAL DAS NEVES", "JULIANA TAVARES CORDEIRO GALVÃO", "LADJANE FERREIRA GUIMARAES", "POLLYHANE MAYUMI ALMEIDA", "THAMYRIS FERREIRA SANTOS"],
        "Equipe 8": ["ANDRE DA SILVA CORDOVILE", "CAIO LUIZ NEVES MAIA", "CHRISTIANE O DE ALMEIDA G MOTA BARRETO", "LUCIANA FLÁVIA DO NASCIMENTO", "MUNIK LUCIENE DE FONTES", "ROSEANE SANTOS DE ANDRADE", "SHEILA CRISTINA RODRIGUES DE LIMA ARAUJO", "TARCISIO BATISTA DA SILVA JUNIOR", "THALLES SIZENANDO AZEVEDO DIAS"],
        "Equipe 9": ["ALUSKA SUYANNE MARQUES DA SILVA", "ELISA CARLA CAMPOS TAVARES", "ERICKSON MOURA DE QUEIROZ", "FRANCISCO ELTOMAR MARTINS FERREIRA", "LILIAN AVELINO DE MORAIS", "OTIMAR ANTÔNIO DA SILVA", "SIMONE DE MEDEIROS TORRES", "SIMONE DOS PASSOS E SILVA LEITE", "TACIANA MARTINS AMORIM BARBOSA BARROS"],
        "Equipe 10": ["ALEXANDRE LINDOSO DE ARAÚJO", "DAYANE FERNANDES MESSIAS", "FABIO COSTA TAVARES DA SILVA", "KALENNE FRANMARRY B ALVES MIYAKAWA", "MARILIA DOHERTY AYRES", "SILVIO MUCIO DE MACEDO FILHO", "WAGNER JEFFERSON MEIRA FILHO"],
        "Equipe 11": ["CAMILLA RODRIGUES MARQUES CARNEIRO", "DIEGO MOURA DA SILVA LOPES", "ELBA MARIA BARROS GALIZA PINHEIRO", "GUILHERME ALBERTI LUPCHINSKI", "JAQUELINE GONDIM SOTERO SIQUEIRA", "LAURA BUARQUE INACIO DE BARROS", "MICHELLE MARIA NASCIMENTO FILGUEIRAS", "NILSON JOSE GONCALVES DOS SANTOS SILVA", "ROSELYNE BEZERRA SMITH"]
    };
 
    function normalizar(texto) {
        if (!texto) return "";
        return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
    }
 
    function esperar(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
 
    function estamosNaTelaDeServidores() {
        const textoPagina = document.body.innerText.toUpperCase();
        if (!textoPagina.includes("POR SERVIDOR")) return false;
        const ths = Array.from(document.querySelectorAll('th')).map(th => th.innerText.toUpperCase());
        return ths.some(t => t.includes("SERVIDOR") || t.includes("NOME"));
    }
 
    async function garantirRetornoParaRaiz() {
        let tentativasVolta = 0;
        while (!estamosNaTelaDeServidores() && tentativasVolta < 15) {
            window.history.back();
            await esperar(1600);
            tentativasVolta++;
        }
        telaProcessosAberta = false;
        await esperar(800);
        await resetarLista();
    }
 
    function obterDadosPagina() {
        const registros = [];
        document.querySelectorAll('tr[data-cy="entityTable"]').forEach(linha => {
            const span = linha.querySelector("td.td-clickable span") || linha.querySelector("td.td-clickable") || linha.querySelector("span");
            if (!span || !span.innerText.trim()) return;
 
            const nomeTxt = span.innerText.trim();
            const totalTxt = linha.querySelectorAll("td")[1]?.innerText?.trim() || "0";
            const totalNum = parseInt(totalTxt, 10) || 0;
 
            registros.push({
                nome: nomeTxt,
                elemento: linha.querySelector("td.td-clickable") || span,
                total: totalNum,
                finalizados: 0,
                emAndamento: 0,
                saldo: totalNum,
                percentual: "0.0%",
                notificacoes: "-"
            });
        });
        return registros;
    }
 
    async function coletarTodos() {
        const mapaRegistros = new Map();
        await resetarLista();
 
        let ultimoPrimeiroNome = "";
 
        while (true) {
            if (abortarVarreduraAtual) return [];
 
            while (varreduraPausada) {
                await esperar(500);
                if (abortarVarreduraAtual) return [];
            }
 
            const linesPagina = obterDadosPagina();
            if (linesPagina.length > 0) {
                const primeiroNomeAtual = linesPagina[0].nome;
                if (primeiroNomeAtual !== ultimoPrimeiroNome) {
                    linesPagina.forEach(reg => {
                        mapaRegistros.set(reg.nome, reg);
                    });
                    ultimoPrimeiroNome = primeiroNomeAtual;
                }
            }
 
            const next = document.querySelector('[aria-label="Página Seguinte"]');
            if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true') break;
 
            next.click();
            await esperar(1800);
        }
        return Array.from(mapaRegistros.values());
    }
 
    async function carregarEquipe() {
        abortarVarreduraAtual = true;
        varreduraAtiva = false;
        varreduraPausada = false;
        indiceAtualVarredura = 0;
        atualizarBotaoPauseUI();
        await esperar(800);
        abortarVarreduraAtual = false;
 
        const equipe = document.getElementById("simapEquipe").value;
 
        if (!estamosNaTelaDeServidores()) {
            await garantirRetornoParaRaiz();
            if (!estamosNaTelaDeServidores()) {
                alert("Por favor, retornar manualmente para a listagem principal antes de carregar.");
                return;
            }
        }
 
        varreduraAtiva = true;
        atualizarBotaoPauseUI();
 
        const painel = document.getElementById("resultadoEquipe");
        painel.style.display = "block";
        painel.style.cssText = `
            position:fixed; top:75px; left:20px; width:220px; height: auto;
            background:#fff; border:1px solid #ffc107; padding:10px; z-index:9999;
            border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,.2);
            font-family: sans-serif; font-size: 13px; font-weight: bold; color: #856404;
        `;
        painel.innerHTML = " 😸 Buscando servidores da equipe...";
 
        const dados = await coletarTodos();
 
        if (abortarVarreduraAtual) return;
 
        let filtrados = [];
        if (equipe === "Todas") {
            filtrados = dados;
        } else {
            filtrados = dados.filter(s =>
                equipes[equipe].some(n => normalizar(s.nome).includes(normalizar(n)))
            );
        }
 
        window.dadosEquipeAtual = filtrados;
        varreduraAtiva = false;
        atualizarBotaoPauseUI();
        renderizarTabela(equipe, filtrados);
    }
 
    function renderizarTabela(nomeEquipe, listaServidores) {
        const painel = document.getElementById("resultadoEquipe");
        painel.style.cssText = `
            position:fixed; top:75px; left:20px; width:950px;
            max-height:600px; overflow:auto; background:#fff;
            border:1px solid #ccc; padding:10px; z-index:9999;
            border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,.2);
        `;
 
        let html = `
        <div id="cabecalhoPainel" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-bottom: 8px;">
            <h3 id="tituloPainel" style="margin: 0; font-size: 15px; font-weight: bold; color: #222; font-family: sans-serif;">Painel supervisão - ${nomeEquipe}</h3>
            <div style="display: flex; gap: 6px;">
                <button id="btnVerificarNotif" style="padding: 4px 10px; cursor: pointer; border: 1px solid #0d6efd; background: #0d6efd; color:#fff; border-radius: 4px; font-weight: bold; font-size: 12px;">📊 Processar Status</button>
                <button id="btnTogglePainel" style="padding: 4px 8px; cursor: pointer; border: 1px solid #999; background: #eee; border-radius: 4px; font-weight: bold; font-size: 12px;">➖ Minimizar</button>
                <button id="btnFecharPainel" style="padding: 4px 8px; cursor: pointer; border: 1px solid #dc3545; background: #dc3545; color: #fff; border: none; border-radius: 4px; font-weight: bold; font-size: 12px;">❌ Fechar</button>
            </div>
        </div>
 
        <div id="conteudoTabelaPainel">
            <table border="1" style="border-collapse:collapse; width:100%; text-align: center; font-family: sans-serif; font-size: 13px;">
            <tr style="background: #f5f5f5; font-weight: bold;">
                <th style="text-align: left; padding: 7px;">Servidor</th>
                <th style="width: 70px;">Total</th>
                <th style="width: 90px; color: #157347;">Finalizados</th>
                <th style="width: 100px; color: #0d6efd;">Em andamento</th>
                <th style="width: 130px; color: #b02a37;">Pendentes</th>
                <th style="width: 75px;">% Fin.</th>
                <th style="width: 110px; color: #dc3545;">⚠️ Notificações</th>
            </tr>`;
 
        let somaTotal = 0;
        let somaFinalizados = 0;
        let somaEmAndamento = 0;
        let somaSaldo = 0;
        let somaNotif = 0;
        let temVarreduraRealizada = false;
 
        listaServidores.forEach((s, idx) => {
            somaTotal += s.total;
            somaFinalizados += s.finalizados;
            somaEmAndamento += s.emAndamento;
            somaSaldo += s.saldo;
 
            let txtNotif = s.notificacoes;
            if (typeof s.notificacoes === 'number') {
                somaNotif += s.notificacoes;
                temVarreduraRealizada = true;
                txtNotif = `<strong>${s.notificacoes}</strong>`;
            }
 
            const corSaldo = s.saldo > 0 ? "#b02a37" : "#157347";
            const pesoSaldo = s.saldo > 0 ? "bold" : "normal";
 
            html += `<tr>
                <td class="nome-servidor" data-idx="${idx}" style="cursor:pointer; color:#0d6efd; text-decoration:underline; text-align: left; padding: 7px;">
                    ${s.nome}
                </td>
                <td style="font-weight: bold;">${s.total}</td>
                <td id="cell-fin-${idx}" style="color: #157347;">${s.notificacoes !== '-' ? s.finalizados : "-"}</td>
                <td id="cell-and-${idx}" style="color: #0d6efd;">${s.notificacoes !== '-' ? s.emAndamento : "-"}</td>
                <td id="cell-sal-${idx}" style="color: ${corSaldo}; font-weight: ${pesoSaldo};">${s.saldo}</td>
                <td id="cell-per-${idx}">${s.percentual}</td>
                <td id="cell-notif-${idx}" style="color: #dc3545;">${txtNotif}</td>
            </tr>`;
        });
 
        const percentualGeral = somaTotal > 0 ? ((somaFinalizados / somaTotal) * 100).toFixed(1) + "%" : "0.0%";
        const corSaldoGeral = somaSaldo > 0 ? "#b02a37" : "#157347";
 
        html += `
            <tr style="background: #e9ecef; font-weight: bold; border-top: 2px solid #bbb;">
                <td style="text-align: left; padding: 7px; color: #333;">TOTAL DA EQUIPE</td>
                <td style="text-align: center;">${somaTotal}</td>
                <td id="total-fin">${temVarreduraRealizada ? somaFinalizados : "-"}</td>
                <td id="total-and">${temVarreduraRealizada ? somaEmAndamento : "-"}</td>
                <td id="total-sal" style="color: ${corSaldoGeral};">${somaSaldo}</td>
                <td id="total-per">${percentualGeral}</td>
                <td id="total-notif" style="color: #dc3545;">${temVarreduraRealizada ? somaNotif : "-"}</td>
            </tr>
        `;
 
        html += `</table></div>`;
        painel.innerHTML = html;
 
        document.getElementById('btnVerificarNotif').addEventListener('click', () => {
            if (!varreduraAtiva) {
                varreduraPausada = false;
                rodarVarreduraProfunda();
            }
        });
 
        document.getElementById('btnTogglePainel').addEventListener('click', function() {
            const divTabela = document.getElementById('conteudoTabelaPainel');
            if (divTabela.style.display === 'none') {
                divTabela.style.display = 'block';
                painel.style.width = '950px';
                this.innerText = '➖ Minimizar';
            } else {
                divTabela.style.display = 'none';
                painel.style.width = 'auto';
                this.innerText = '➕ Mostrar Painel';
            }
        });
 
        document.getElementById('btnFecharPainel').addEventListener('click', () => painel.style.display = "none");
 
        document.querySelectorAll(".nome-servidor").forEach(td => {
            td.addEventListener("click", () => {
                const idx = td.getAttribute("data-idx");
                abrirServidor(window.dadosEquipeAtual[idx].nome);
            });
        });
    }
 
    function alternarPausaGlobal() {
        if (!varreduraAtiva) return;
        varreduraPausada = !varreduraPausada;
        atualizarBotaoPauseUI();
    }
 
    function atualizarBotaoPauseUI() {
        const btn = document.getElementById("btnGlobalPause");
        if (!btn) return;
 
        if (!varreduraAtiva) {
            btn.innerText = "⏸️";
            btn.style.background = "#e9ecef";
            btn.disabled = true;
            btn.title = "Nenhum processo ativo no momento";
            return;
        }
 
        btn.disabled = false;
        if (varreduraPausada) {
            btn.innerText = "▶️";
            btn.style.background = "#ffc107";
            btn.title = "Processo pausado. Clique para continuar.";
        } else {
            btn.innerText = "⏸️";
            btn.style.background = "#6c757d";
            btn.title = "Processo em andamento. Clique para pausar.";
        }
    }
 
    async function rodarVarreduraProfunda() {
        varreduraAtiva = true;
        varreduraPausada = false;
        atualizarBotaoPauseUI();
 
        const btnStatus = document.getElementById('btnVerificarNotif');
        const lista = window.dadosEquipeAtual;
 
        for (let i = indiceAtualVarredura; i < lista.length; i++) {
            if (abortarVarreduraAtual) break;
 
            indiceAtualVarredura = i;
 
            while (varreduraPausada) {
                await esperar(500);
                if (abortarVarreduraAtual) break;
            }
            if (abortarVarreduraAtual) break;
 
            const servidor = lista[i];
            if (btnStatus) btnStatus.innerText = `⏳ (${servidor.nome.split(" ")[0]}...)`;
 
            if (document.getElementById(`cell-fin-${i}`)) {
                document.getElementById(`cell-fin-${i}`).innerText = "⏳";
                document.getElementById(`cell-and-${i}`).innerText = "⏳";
                document.getElementById(`cell-notif-${i}`).innerText = "⏳";
            }
 
            // Garante estabilidade na abertura com espera de segurança maior
            await abrirServidorParaVarredura(servidor.nome);
            if (abortarVarreduraAtual) break;
 
            let contagemNotif = 0;
            let contagemFinalizados = 0;
            let contagemEmAndamento = 0;
            const processosProcessados = new Set();
 
            // Espera extra para renderização da primeira tela de processos do servidor
            await esperar(800);
 
            while (true) {
                if (abortarVarreduraAtual) break;
 
                while (varreduraPausada) {
                    await esperar(500);
                    if (abortarVarreduraAtual) break;
                }
                if (abortarVarreduraAtual) break;
 
                const linesProcesso = document.querySelectorAll('tr[data-cy="entityTable"], tbody tr');
 
                linesProcesso.forEach((linha) => {
                    const textoLinha = linha.innerText.trim();
                    if (!textoLinha) return;
 
                    if (processosProcessados.has(textoLinha)) return;
                    processosProcessados.add(textoLinha);
 
                    const iconesVermelhos = linha.querySelectorAll('i.pi.pi-book.text-red-500, i.pi-book.text-red-500');
                    contagemNotif += iconesVermelhos.length;
 
                    const dp = linha.querySelector('p-dropdown, .p-dropdown');
                    if (dp) {
                        const label = dp.getAttribute('aria-label') || dp.querySelector('.p-dropdown-label')?.getAttribute('aria-label') || dp.querySelector('.p-dropdown-label')?.innerText?.trim();
                        if (label) {
                            if (label.includes("Finalizado")) {
                                contagemFinalizados++;
                            } else if (label.includes("Em andamento")) {
                                contagemEmAndamento++;
                            }
                        }
                    }
                });
 
                const nextBtn = document.querySelector('[aria-label="Página Seguinte"]');
                if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') break;
 
                nextBtn.click();
                await esperar(1800);
            }
 
            if (abortarVarreduraAtual) break;
 
            const saldoCalculado = servidor.total - (contagemFinalizados + contagemEmAndamento);
            const percentualCalculado = servidor.total > 0 ? ((contagemFinalizados / servidor.total) * 100).toFixed(1) + "%" : "0.0%";
 
            servidor.notificacoes = contagemNotif;
            servidor.finalizados = contagemFinalizados;
            servidor.emAndamento = contagemEmAndamento;
            servidor.saldo = saldoCalculado >= 0 ? saldoCalculado : 0;
            servidor.percentual = percentualCalculado;
 
            if (document.getElementById(`cell-fin-${i}`)) {
                document.getElementById(`cell-fin-${i}`).innerHTML = `<strong>${contagemFinalizados}</strong>`;
                document.getElementById(`cell-and-${i}`).innerHTML = `<strong>${contagemEmAndamento}</strong>`;
                document.getElementById(`cell-sal-${i}`).innerHTML = `<strong>${servidor.saldo}</strong>`;
                document.getElementById(`cell-per-${i}`).innerText = percentualCalculado;
                document.getElementById(`cell-notif-${i}`).innerHTML = `<strong>${contagemNotif}</strong>`;
 
                const cSaldo = document.getElementById(`cell-sal-${i}`);
                if (servidor.saldo > 0) { cSaldo.style.color = "#b02a37"; cSaldo.style.fontWeight = "bold"; }
                else { cSaldo.style.color = "#157347"; cSaldo.style.fontWeight = "normal"; }
                atualizarTotaisGerais();
            }
 
            await garantirRetornoParaRaiz();
        }
 
        if (!abortarVarreduraAtual && btnStatus) {
            btnStatus.innerText = "📊 Processar Status";
        }
        varreduraAtiva = false;
        indiceAtualVarredura = 0;
        atualizarBotaoPauseUI();
    }
 
    function atualizarTotaisGerais() {
        const lista = window.dadosEquipeAtual;
        if (!lista) return;
        let totalGeralNotif = 0;
        let totalGeralFin = 0;
        let totalGeralAnd = 0;
        let totalGeralSal = 0;
        let temAlgumDado = false;
 
        lista.forEach(s => {
            if (s.notificacoes !== '-') {
                totalGeralNotif += s.notificacoes;
                totalGeralFin += s.finalizados;
                totalGeralAnd += s.emAndamento;
                temAlgumDado = true;
            }
            totalGeralSal += s.saldo;
        });
 
        if (document.getElementById('total-fin')) {
            document.getElementById('total-fin').innerHTML = temAlgumDado ? totalGeralFin : "-";
            document.getElementById('total-and').innerHTML = temAlgumDado ? totalGeralAnd : "-";
            document.getElementById('total-sal').innerHTML = totalGeralSal;
            document.getElementById('total-notif').innerHTML = temAlgumDado ? totalGeralNotif : "-";
 
            const totalMatriz = lista.reduce((acc, curr) => acc + curr.total, 0);
            document.getElementById('total-per').innerText = (temAlgumDado && totalMatriz > 0) ? ((totalGeralFin / totalMatriz) * 100).toFixed(1) + "%" : "0.0%";
 
            const tSal = document.getElementById('total-sal');
            tSal.style.color = totalGeralSal > 0 ? "#b02a37" : "#157347";
        }
    }
 
    async function abrirServidorParaVarredura(nome) {
        let travaSeguranca = 0;
        while (!estamosNaTelaDeServidores() && travaSeguranca < 10) {
            if (abortarVarreduraAtual) return;
            await esperar(1000);
            travaSeguranca++;
        }
 
        await resetarLista();
        let encontrou = false;
 
        while (true) {
            if (abortarVarreduraAtual) return;
            const linhas = document.querySelectorAll('tr[data-cy="entityTable"]');
            for (const linha of linhas) {
                const span = linha.querySelector("td.td-clickable span") || linha.querySelector("span");
                if (!span) continue;
 
                if (span.innerText.trim() === nome) {
                    // Tenta o clique de forma assistida até 3 vezes caso o sistema falhe
                    for(let tentativa=0; tentativa<3; tentativa++) {
                        const alvo = linha.querySelector("td.td-clickable") || span;
                        if (alvo) {
                            alvo.click();
                            telaProcessosAberta = true;
                            break;
                        }
                        await esperar(300);
                    }
                    encontrou = true;
                    break;
                }
            }
            if (encontrou) {
                await esperar(2400); // Tempo seguro para renderizar
                return;
            }
 
            const next = document.querySelector('[aria-label="Página Seguinte"]');
            if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true') break;
            next.click();
            await esperar(1600);
        }
    }
 
    async function abrirServidor(nome) {
        if (!estamosNaTelaDeServidores()) {
            await garantirRetornoParaRaiz();
        }
        await abrirServidorParaVarredura(nome);
    }
 
    async function resetarLista() {
        const first = document.querySelector('[aria-label="Primeira Página"]');
        if (first && !first.disabled && first.getAttribute('aria-disabled') !== 'true') {
            first.click();
            await esperar(1800);
        }
    }
 
    function criarFiltro() {
        if (document.getElementById("simapEquipe")) return;
 
        const container = document.createElement("div");
        container.style.cssText = `
            position:fixed; top:10px; left:180px; z-index:9999;
            background:#fff; padding:5px 10px; border:1px solid #ccc;
            border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,.15);
            display: flex; align-items: center; height: 32px; gap: 6px;
        `;
 
        const select = document.createElement("select");
        select.id = "simapEquipe";
        select.style.cssText = "padding: 2px; font-size: 13px; cursor: pointer;";
 
        Object.keys(equipes).forEach(e => {
            const opt = document.createElement("option");
            opt.value = e;
            opt.textContent = e;
            select.appendChild(opt);
        });
 
        const btnCarregar = document.createElement("button");
        btnCarregar.innerText = "📊 Carregar";
        btnCarregar.style.cssText = "padding: 3px 8px; cursor: pointer; font-weight: bold; font-size: 13px;";
        btnCarregar.onclick = carregarEquipe;
 
        const btnGlobalPause = document.createElement("button");
        btnGlobalPause.id = "btnGlobalPause";
        btnGlobalPause.innerText = "⏸️";
        btnGlobalPause.disabled = true;
        btnGlobalPause.style.cssText = "padding: 3px 10px; cursor: pointer; font-weight: bold; font-size: 13px; border-radius: 4px; border:1px solid #ccc; background:#e9ecef; color:#333;";
        btnGlobalPause.onclick = alternarPausaGlobal;
 
        const btnInicio = document.createElement("button");
        btnInicio.id = "btnIrInicioPlanilha";
        btnInicio.innerText = "🏠 Voltar página inicial da planilha";
        btnInicio.style.cssText = "padding: 3px 8px; cursor: pointer; font-weight: bold; font-size: 13px; background: #e9ecef; border: 1px solid #ced4da; border-radius: 4px;";
        btnInicio.onclick = async function() {
            this.innerText = "⏳ Voltando para Pág 1...";
            await garantirRetornoParaRaiz();
            this.innerText = "🏠 Voltar página inicial da planilha";
        };
 
        container.appendChild(select);
        container.appendChild(btnCarregar);
        container.appendChild(btnGlobalPause);
        container.appendChild(btnInicio);
        document.body.appendChild(container);
    }
 
    function criarPainel() {
        if (document.getElementById("resultadoEquipe")) return;
 
        const div = document.createElement("div");
        div.id = "resultadoEquipe";
        div.style.cssText = `
            position:fixed; top:75px; left:20px; width:950px;
            max-height:600px; overflow:auto; background:#fff;
            border:1px solid #ccc; padding:10px; z-index:9999;
            border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,.2);
            display:none;
        `;
        document.body.appendChild(div);
    }
 
carregarDadosPlanilha();
 
const observer = new MutationObserver(() => {
    aplicarTagsNaTela();
});
 
observer.observe(document.body, {
    childList: true,
    subtree: true
});
 
setInterval(() => {
    const rows = document.querySelectorAll('tr[data-cy="entityTable"]');
 
    if (rows.length > 0) {
        criarFiltro();
        criarPainel();
    }
 
    aplicarTagsNaTela();
    injetarMenuFlutuante();
 
}, 1500);
    function extrairIdEAbas(url) {
        const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        const gidMatch = url.match(/[#&?]gid=(\d+)/);
        return {
            id: idMatch ? idMatch[1] : null,
            gid: gidMatch ? gidMatch[1] : "0"
        };
    }
 
    function limparNPU(npuRaw) {
        return String(npuRaw || "").replace(/\D/g, "");
    }
 
    function parsearCSV(texto) {
        const linhas = [];
        let cols = [], cur = "", dentroAspas = false;
        for (let i = 0; i < texto.length; i++) {
            const c = texto[i];
            if (c === '"') {
                if (dentroAspas && texto[i + 1] === '"') { cur += '"'; i++; }
                else dentroAspas = !dentroAspas;
            } else if (c === "," && !dentroAspas) {
                cols.push(cur); cur = "";
            } else if ((c === "\n" || (c === "\r" && texto[i + 1] === "\n")) && !dentroAspas) {
                if (c === "\r") i++;
                cols.push(cur); cur = "";
                if (cols.some(v => v.trim())) linhas.push(cols);
                cols = [];
            } else {
                cur += c;
            }
        }
        cols.push(cur);
        if (cols.some(v => v.trim())) linhas.push(cols);
        return linhas;
    }
 
    function extrairPrioridade(textoCelula) {
        if (!textoCelula) return null;
        const m = String(textoCelula).trim().match(/^(\d+)/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return (n >= 1 && n <= 9) ? n : null;
    }
 
    function processarDadosPlanilha(linhasCsv) {
        if (linhasCsv.length < 2) return;
        let headerIdx = -1;
        for (let i = 0; i < Math.min(5, linhasCsv.length); i++) {
            const row = linhasCsv[i].map(h => String(h ?? "").toUpperCase().trim());
            if (row.some(h => h === "NPU" || h.includes("PROCESSO"))) {
                headerIdx = i;
                break;
            }
        }
        if (headerIdx < 0) headerIdx = 0;
        const header = linhasCsv[headerIdx].map(h => String(h ?? "").toUpperCase().trim());
        const dados = linhasCsv.slice(headerIdx + 1);
        const idxNPU = header.findIndex(h => h.includes("PROCESSO") || h === "NPU");
        const idxTipo = header.findIndex(h => h.includes("TIPO") && h.includes("ATEND"));
        dados.forEach(row => {
            const npuBruto = row[idxNPU >= 0 ? idxNPU : 0];
            const npuChave = limparNPU(npuBruto);
            if (npuChave.length !== 20) return;
            let prioridadeIdentificada = 1;
            if (idxTipo >= 0) {
                prioridadeIdentificada = extrairPrioridade(row[idxTipo]) || 1;
            } else {
                for (let i = 0; i < row.length; i++) {
                    if (i === idxNPU) continue;
                    const p = extrairPrioridade(row[i]);
                    if (p) { prioridadeIdentificada = p; break; }
                }
            }
            BANCO_PRIORIDADES.set(npuChave, prioridadeIdentificada);
        });
        aplicarTagsNaTela();
    }
 
    function carregarDadosPlanilha() {
        const { id, gid } = extrairIdEAbas(URL_PLANILHA);
        if (!id) return;
        const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
        GM_xmlhttpRequest({
            method: "GET",
            url: csvUrl,
            onload: function(response) {
                if (response.status === 200) {
                    const matriz = parsearCSV(response.responseText);
                    processarDadosPlanilha(matriz);
                }
            }
        });
    }
 
    function aplicarTagsNaTela() {
        if (BANCO_PRIORIDADES.size === 0) return;
        const regexNPU = /\b\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}\b/g;
        const elementos = document.querySelectorAll("td, span, a, div.ui-outputpanel");
        elementos.forEach(el => {
            if (el.querySelector(".tag-prioridade") || el.classList.contains("tag-prioridade")) return;
            if (el.childNodes.length > 0) {
                for (let node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE && regexNPU.test(node.nodeValue)) {
                        const correspondencias = node.nodeValue.match(regexNPU);
                        if (correspondencias) {
                            correspondencias.forEach(npuMatch => {
                                const chave = limparNPU(npuMatch);
                                if (BANCO_PRIORIDADES.has(chave)) {
                                    const p = BANCO_PRIORIDADES.get(chave);
                                    const tag = document.createElement("span");
                                    tag.className = `tag-prioridade prio-p${p}`;
                                    tag.textContent = `P${p}`;
                                    tag.title = `Prioridade Nível P${p}`;
                                    el.appendChild(tag);
                                }
                            });
                        }
                    }
                }
            }
        });
    }
 
    // ==========================================
    // PARTE 2: LÓGICA DO MENU DE OBSERVAÇÕES
    // ==========================================
 
    const opcoesPadrao = [
        { texto: "DÚVIDA (campo aberto)", precisaExtra: true, labelExtra: "Digite a dúvida:" },
        { texto: "SUPERVISÃO (campo aberto)", precisaExtra: true, labelExtra: "Digite o motivo da supervisão:" },
        { texto: "SISCONDJ (Alvará gravado OU Vinculação de Conta)", precisaExtra: false },
        { texto: "PRAZO ABERTO FORA DO SISTEMA (Data de Retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:" },
        { texto: "PRAZO EM CURSO NO SISTEMA", precisaExtra: false },
        { texto: "PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação - informar nº)", precisaExtra: true, labelExtra: "Informe o Nº do Tema/Ação:" },
        { texto: "PROCESSO SUSPENSO (Determinação judicial - informar data de retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:" },
        { texto: "PROCESSO SUSPENSO (Data de Retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:" },
        { texto: "PROCESSO SUSPENSO (Resposta de Precatória - PC 03/2021)", precisaExtra: false },
        { texto: "PROCESSO SUSPENSO (Julg. Agravo/Conflito de competência - informar nº)", precisaExtra: true, labelExtra: "Informe o Nº do processo:" },
        { texto: "ARQUIVO PROVISÓRIO (Data de retorno OU Motivo)", precisaExtra: true, labelExtra: "Informe a Data ou Motivo:" },
        { texto: "ERRO DE FLUXO (Nº do Chamado)", precisaExtra: true, labelExtra: "Informe o Nº do Chamado:" },
        { texto: "LEILÃO", precisaExtra: false },
        { texto: "REC. JUD./FALÊNCIA (não engloba habilitação de crédito)", precisaExtra: false },
        { texto: "PRECATÓRIO/RPV", precisaExtra: false },
        { texto: "CENTRAL DE AGILIZAÇÃO (SEM FLUXO)", precisaExtra: false },
        { texto: "INTEGRALMENTE CUMPRIDO POR OUTRO SERVIDOR", precisaExtra: false }
    ];
 
    let textoPrevioAoSelect = "";
 
    function injetarMenuFlutuante() {
        const txtAreaOriginal = document.getElementById('field_observacao');
        if (!txtAreaOriginal || document.getElementById('containerMenuTontom')) return;
 
        const container = document.createElement('div');
        container.id = 'containerMenuTontom';
        container.style.cssText = 'margin-bottom: 12px; padding: 10px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; font-family: sans-serif;';
 
        const label = document.createElement('label');
        label.innerText = '📋 Selecione a Observação Padronizada:';
        label.style.cssText = 'display: block; font-weight: bold; font-size: 13px; margin-bottom: 5px; color: #495057;';
        container.appendChild(label);
 
        const select = document.createElement('select');
        select.id = 'selectObsTontom';
        select.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; background-color: #fff; cursor: pointer;';
 
        const optDefault = document.createElement('option');
        optDefault.value = '';
        optDefault.innerText = '-- Escolha uma opção (Opcional) --';
        select.appendChild(optDefault);
 
        opcoesPadrao.forEach((opt, index) => {
            const o = document.createElement('option');
            o.value = index;
            o.innerText = opt.texto;
            select.appendChild(o);
        });
        container.appendChild(select);
 
        const divExtra = document.createElement('div');
        divExtra.id = 'divExtraTontom';
        divExtra.style.cssText = 'display: none; margin-top: 8px;';
 
        const labelExtra = document.createElement('label');
        labelExtra.id = 'labelExtraTontom';
        labelExtra.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 3px; color: #495057;';
 
        const inputExtra = document.createElement('input');
        inputExtra.id = 'inputExtraTontom';
        inputExtra.type = 'text';
        inputExtra.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;';
 
        divExtra.appendChild(labelExtra);
        divExtra.appendChild(inputExtra);
        container.appendChild(divExtra);
 
        txtAreaOriginal.parentNode.insertBefore(container, txtAreaOriginal);
 
        select.addEventListener('change', function() {
            const idx = this.value;
            if (idx === '') {
                divExtra.style.display = 'none';
                inputExtra.value = '';
                return;
            }
 
            const opcaoSelecionada = opcoesPadrao[idx];
            textoPrevioAoSelect = txtAreaOriginal.value.trim();
 
            if (opcaoSelecionada.precisaExtra) {
                labelExtra.innerText = opcaoSelecionada.labelExtra;
                divExtra.style.display = 'block';
                inputExtra.value = '';
                inputExtra.focus();
 
                acumularTextoOficial(opcaoSelecionada.texto);
            } else {
                divExtra.style.display = 'none';
                inputExtra.value = '';
 
                acumularTextoOficial(opcaoSelecionada.texto);
                select.value = '';
            }
        });
 
        inputExtra.addEventListener('input', function() {
            const idx = select.value;
            if (idx === '') return;
 
            const opcaoSelecionada = opcoesPadrao[idx];
            const infoAdicional = this.value.trim();
            const textoTermo = infoAdicional ? `${opcaoSelecionada.texto} - ${infoAdicional}` : opcaoSelecionada.texto;
 
            substituirTextoTemporario(textoTermo);
        });
 
        inputExtra.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                select.value = '';
                divExtra.style.display = 'none';
                inputExtra.value = '';
                txtAreaOriginal.focus();
            }
        });
    }
 
    function acumularTextoOficial(novoTexto) {
        const txtAreaOriginal = document.getElementById('field_observacao');
        if (!txtAreaOriginal) return;
 
        if (textoPrevioAoSelect.length > 0) {
            txtAreaOriginal.value = textoPrevioAoSelect + "\n" + novoTexto;
        } else {
            txtAreaOriginal.value = novoTexto;
        }
 
        dispararEventos(txtAreaOriginal);
    }
 
    function substituirTextoTemporario(novoTexto) {
        const txtAreaOriginal = document.getElementById('field_observacao');
        if (!txtAreaOriginal) return;
 
        if (textoPrevioAoSelect.length > 0) {
            txtAreaOriginal.value = textoPrevioAoSelect + "\n" + novoTexto;
        } else {
            txtAreaOriginal.value = novoTexto;
        }
 
        dispararEventos(txtAreaOriginal);
    }
 
    function dispararEventos(elemento) {
        elemento.dispatchEvent(new Event('input', { bubbles: true }));
        elemento.dispatchEvent(new Event('change', { bubbles: true }));
    }
 
 
})();
