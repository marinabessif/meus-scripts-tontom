// ==UserScript==
// @name         Tontom-Simap (Servidor)
// @namespace    simap-tjpe
// @version      2.4.1
// @description  Menu de observações, Prioridades, painel móvel com fila de trabalho consolidada, filtros, botões de cópia individual, sincronização em tempo real e redirecionamento de foco por página, ano 4 dígitos, SISCONDJ - valor indisponível SISBAJUD, PROCESSO SUSPENSO (Até ulterior deliberação - Sem data de retorno).
// @match        https://simap.svc.tjpe.jus.br/*
// @match        https://frontend.pje.cloud.tjpe.jus.br/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      docs.google.com
// @run-at       document-end
// @downloadURL https://update.greasyfork.org/scripts/580884/Tontom-Simap%20%28Servidor%29.user.js
// @updateURL https://update.greasyfork.org/scripts/580884/Tontom-Simap%20%28Servidor%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    let varreduraAtiva = false;
    let varreduraPausada = false;
    let abortarVarredura = false;

    // Array global para armazenar os dados dos processos coletados de todas as páginas
    let processosVarridos = [];

    // Diagnóstico da última varredura (linhas lidas por página, NPUs repetidos etc.)
    let diagnosticoVarredura = { paginas: [], repetidos: [] };
    // Objeto global para armazenar os contadores de prioridades em tempo real
    let contadoresPrio = {
        1: { total: 0, fin: 0, and: 0, pen: 0, notif: 0 },
        2: { total: 0, fin: 0, and: 0, pen: 0, notif: 0 },
        3: { total: 0, fin: 0, and: 0, pen: 0, notif: 0 },
        4: { total: 0, fin: 0, and: 0, pen: 0, notif: 0 }
    };

    // ==========================================
    // PARTE 1: LÓGICA DAS TAGS DE PRIORIDADE
    // ==========================================

    const URL_PLANILHA = "https://docs.google.com/spreadsheets/d/1RFS3XkGQ7Ga1NqCMXJmqYGcR-JBCXtYB7r51quVb0yE/edit?gid=1744875210";
    const URL_PLANILHA_OBSERVACOES = "https://docs.google.com/spreadsheets/d/1RFS3XkGQ7Ga1NqCMXJmqYGcR-JBCXtYB7r51quVb0yE/edit?gid=388351178";
    let opcoesObservacoesDinamicas = null;
    let callbackAtualizarMenuObservacoes = null;

    try {
        const cacheObs = localStorage.getItem('tontom_obs_cache_v1');
        if (cacheObs) {
            const parsed = JSON.parse(cacheObs);
            if (Array.isArray(parsed) && parsed.length > 0) {
                opcoesObservacoesDinamicas = parsed;
            }
        }
    } catch (e) {}

    GM_addStyle(`
        .tag-prioridade {
            display: inline-flex;
            align-items: center;
            margin-left: 6px;
            font-size: 11px;
            color: #fff !important;
            border-radius: 4px;
            text-transform: uppercase;
            box-shadow: 1px 1px 3px rgba(0,0,0,0.15);
            vertical-align: middle;
            overflow: hidden; /* Essencial para a borda arredondada cortar os elementos de dentro */
        }
        .tag-p-letra {
            background-color: rgba(0, 0, 0, 0.25); /* Fundo 25% mais escuro para destacar o P */
            padding: 2px 5px;
            font-weight: 900;
        }
        .tag-p-numero {
            padding: 2px 6px;
            font-weight: bold;
            letter-spacing: 0.5px;
        }
        .prio-p1 { background-color: #ef4444 !important; }
        .prio-p2 { background-color: #f97316 !important; }
        .prio-p3 { background-color: #eab308 !important; color: #000 !important; }
        .prio-p4 { background-color: #3b82f6 !important; }
        .prio-p5 { background-color: #a855f7 !important; }
        .prio-p6 { background-color: #10b981 !important; }
        .prio-p7 { background-color: #6366f1 !important; }
        .prio-p8 { background-color: #ec4899 !important; }
        .prio-p9 { background-color: #64748b !important; }
        .tag-saldo { background-color: #059669 !important; color: #fff !important; }
        .tag-incon { background-color: #d97706 !important; color: #fff !important; }
        .tag-scga { background-color: #facc15 !important; color: #000 !important; }
    `);

    const BANCO_PRIORIDADES = new Map();
    // Tags especiais da planilha (ex: "Saldo OUT 02", "INCON OUT 02"), indexadas pela chave do NPU
    const BANCO_TAGS_ESPECIAIS = new Map();
    // NPUs marcados com [SCGA] na planilha (mesma coluna da prioridade/saldo/inconsistência)
    const BANCO_SCGA = new Set();
    // Descrição curta da prioridade SCGA (ex: "Tutela/Liminar"), indexada pela chave do NPU
    const BANCO_PRIO_DESC = new Map();

    // Tabela de referência das prioridades do SCGA (Central de Atendimento / urgências).
    // "desc" é o texto que vem na coluna C (comparado sem acento, sem pontuação e sem diferenciar maiúsculas);
    // "tag" é o texto curto que aparece depois do número da prioridade na tag.
    const PRIORIDADES_SCGA = [
        { desc: "TUTELA / LIMINAR", tag: "Tutela/Liminar" },
        { desc: "AGILIZAÇÃO DE ALVARÁ", tag: "Ag. Alvará" },
        { desc: "BLOQUEIO / DESBLOQUEIO", tag: "Bloq./Desbloq." },
        { desc: "HABILITAÇÃO DE ADVOGADO", tag: "Hab. Adv" },
        { desc: "RETIFICAR O VALOR DA CAUSA", tag: "Retif. Valor da Causa" },
        { desc: "SOLICITAÇÃO DE CERTIDÃO P/AGRAVO", tag: "Certidão Agravo" },
        { desc: "CUSTAS - PARCELAMENTO - DIRETORIAS", tag: "Custas Parc." },
        { desc: "CUSTAS - EMISSÃO DE GUIA - DIRETORIAS", tag: "Custas Emiss." },
        { desc: "SOLICITAÇÃO DE OUTRAS CERTIDÕES", tag: "Outras Certidões" },
        { desc: "BAAF", tag: "BAAF" },
        { desc: "GAB - PRIORIDADE SOLICITADA PELO MAGISTRADO", tag: "GAB. Prio. Mag." },
        { desc: "SOLICITAÇÃO DE CONCLUSÃO", tag: "Conclusão" },
        { desc: "AGILIZAÇÃO DE EXPEDIENTE", tag: "Agilização Exp." },
        { desc: "GAB - ALVARÁ DE URGÊNCIA", tag: "GAB-Alvará URGÊNCIA" },
        { desc: "GAB - CONCLUSÃO/DECURSO DE PRAZO", tag: "GAB-Conclusão/Decurso" },
        { desc: "GAB - TUTELAS E URGÊNCIAS", tag: "GAB-Tutela/URGÊNCIAS" },
        { desc: "AGILIZAÇÃO - CUMPRIMENTO TUTELA DE URGÊNCIA", tag: "AGIL. Tutela URGÊNCIA" }
    ];

    function normalizarTextoPlanilha(texto) {
        return String(texto || "")
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, " ")
            .trim();
    }

    const PRIORIDADES_SCGA_NORMALIZADAS = PRIORIDADES_SCGA.map(item => ({
        chave: " " + normalizarTextoPlanilha(item.desc) + " ",
        tag: item.tag
    }));

    // Se a célula contém alguma prioridade da tabela do SCGA, devolve o texto curto da tag (senão null).
    // O número da prioridade NÃO é usado na comparação (vem de extrairPrioridade), só a descrição.
    function identificarPrioridadeSCGA(textoCelula) {
        if (!textoCelula) return null;
        const textoNorm = " " + normalizarTextoPlanilha(textoCelula) + " ";
        const achado = PRIORIDADES_SCGA_NORMALIZADAS.find(item => textoNorm.includes(item.chave));
        return achado ? achado.tag : null;
    }

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
        const clean = String(textoCelula).trim();

        // 1. Tenta número (com ou sem decimal) no início da célula (ex: "1", "1.1", "2 - (+20 dias)")
        let m = clean.match(/^\s*(\d+(?:[.,]\d+)?)/);
        if (m) {
            const valorStr = m[1].replace(',', '.');
            const base = parseInt(valorStr, 10);
            if (base >= 1 && base <= 11) return valorStr;
        }

        // 2. Tenta padrões com prefixos comuns (ex: "P1", "P 1.1", "Origem 2", "Prioridade 4")
        m = clean.match(/(?:P|p|Origem|Prioridade)\s*(\d+(?:[.,]\d+)?)/i);
        if (m) {
            const valorStr = m[1].replace(',', '.');
            const base = parseInt(valorStr, 10);
            if (base >= 1 && base <= 11) return valorStr;
        }
        return null;
    }

    function extrairTagEspecial(textoCelula) {
        if (!textoCelula) return null;
        const str = String(textoCelula).trim();
        const match = str.match(/(saldo|inconsist[êe]ncias?|incon)(?:\s+plan|\s+planilha)?\s+([a-zà-ú]{3,})\s+(\d{1,2})/i);
        if (match) {
            const tipoRaw = match[1].toLowerCase();
            const tipo = tipoRaw.includes('saldo') ? 'Saldo' : 'INCON';
            const mes = match[2].substring(0, 3).toUpperCase();
            const num = String(match[3]).padStart(2, '0');
            return `${tipo} ${mes} ${num}`;
        }
        return null;
    }

    // Detecta o marcador [SCGA] (com ou sem colchetes) no texto da célula
    function temTagSCGA(textoCelula) {
        if (!textoCelula) return false;
        return /(^|[^a-z0-9])scga([^a-z0-9]|$)/i.test(String(textoCelula));
    }

    function processarDadosPlanilha(linhasCsv) {
        if (linhasCsv.length < 2) return;
        let headerIdx = -1;
        for (let i = 0; i < Math.min(5, linhasCsv.length); i++) {
            const row = linhasCsv[i].map(h => String(h ?? "").toUpperCase().trim());
            if (row.some(h => h === "NPU" || h.includes("PROCESSO") || h.includes("NUMERO"))) {
                headerIdx = i;
                break;
            }
        }
        if (headerIdx < 0) headerIdx = 0;
        const header = linhasCsv[headerIdx].map(h => String(h ?? "").toUpperCase().trim());
        const dados = linhasCsv.slice(headerIdx + 1);
        const idxNPU = header.findIndex(h => h === "NPU" || h.includes("PROCESSO") || h.includes("NUMERO"));
        let idxTipo = header.findIndex(h => h === "ORIGEM" || h === "ORIGENS" || h.includes("TIPO") || h === "PRIORIDADE" || h === "PRIO");

        if (idxTipo < 0) {
            idxTipo = header.findIndex(h => h.includes("ORIGEM") || h.includes("PRIO"));
        }
        BANCO_PRIORIDADES.clear();
        BANCO_TAGS_ESPECIAIS.clear();
        BANCO_SCGA.clear();
        BANCO_PRIO_DESC.clear();

        dados.forEach(row => {
            const npuBruto = row[idxNPU >= 0 ? idxNPU : 0];
            const npuChave = limparNPU(npuBruto);
            if (npuChave.length !== 20) return;

            let prioridadeIdentificada = 1;
            let tagEspecialIdentificada = null;
            let scgaIdentificada = false;
            let descScgaIdentificada = null;
            if (idxTipo >= 0) {
                prioridadeIdentificada = extrairPrioridade(row[idxTipo]) || 1;
                tagEspecialIdentificada = extrairTagEspecial(row[idxTipo]);
                descScgaIdentificada = identificarPrioridadeSCGA(row[idxTipo]);
                scgaIdentificada = temTagSCGA(row[idxTipo]) || descScgaIdentificada !== null;
            } else {
                for (let i = 0; i < row.length; i++) {
                    if (i === idxNPU) continue;
                    const p = extrairPrioridade(row[i]);
                    if (p) prioridadeIdentificada = p;
                    const tagEsp = extrairTagEspecial(row[i]);
                    if (tagEsp) tagEspecialIdentificada = tagEsp;
                    const descScga = identificarPrioridadeSCGA(row[i]);
                    if (descScga) descScgaIdentificada = descScga;
                    if (temTagSCGA(row[i]) || descScga) scgaIdentificada = true;
                }
            }
            BANCO_PRIORIDADES.set(npuChave, prioridadeIdentificada);
            if (tagEspecialIdentificada) BANCO_TAGS_ESPECIAIS.set(npuChave, tagEspecialIdentificada);
            if (scgaIdentificada) BANCO_SCGA.add(npuChave); // um único NPU só recebe a tag SCGA uma vez (Set)
            if (descScgaIdentificada) BANCO_PRIO_DESC.set(npuChave, descScgaIdentificada);
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

    function processarObservacoesPlanilha(matriz) {
        if (!matriz || matriz.length === 0) return null;

        let idxAtivo = -1;
        let idxMenu = -1;
        let idxPrefixo = -1;
        let idxTipo = -1;
        let idxRotulo = -1;
        let idxSubmenu = -1;

        // Varre as primeiras 3 linhas para detectar os índices das colunas por cabeçalho
        for (let r = 0; r < Math.min(3, matriz.length); r++) {
            const rowNorm = matriz[r].map(c => normalizarTextoPlanilha(c || ''));
            rowNorm.forEach((col, i) => {
                if (idxAtivo === -1 && /^ATIVO\b/i.test(col)) idxAtivo = i;
                if (idxMenu === -1 && /MENU/i.test(col)) idxMenu = i;
                if (idxPrefixo === -1 && /PREFIXO|TEXTO BASE/i.test(col)) idxPrefixo = i;
                if (idxTipo === -1 && /TIPO/i.test(col)) idxTipo = i;
                if (idxRotulo === -1 && /ROTULO|PERGUNTA/i.test(col)) idxRotulo = i;
                if (idxSubmenu === -1 && /SUBMENU/i.test(col)) idxSubmenu = i;
            });
        }

        // Se não identificou por cabeçalho, adota a posição padrão da planilha (Col A rótulos, B Ativo...)
        if (idxAtivo === -1) idxAtivo = 1;
        if (idxMenu === -1) idxMenu = 2;
        if (idxPrefixo === -1) idxPrefixo = 3;
        if (idxTipo === -1) idxTipo = 4;
        if (idxRotulo === -1) idxRotulo = 5;
        if (idxSubmenu === -1) idxSubmenu = 6;

        const ROTULOS_PADRAO = {
            "SUPERVISÃO/DÚVIDA": "Detalhe",
            "SUPERVISAO/DUVIDA": "Detalhe",
            "*SERVIDOR": "Lembrete",
            "*ERRO DE FLUXO": "Chamado"
        };

        const resultado = [];

        for (let r = 1; r < matriz.length; r++) {
            const row = matriz[r];
            if (!row || row.length === 0) continue;

            const colAtivo = normalizarTextoPlanilha(row[idxAtivo] || '');
            if (colAtivo !== 'SIM' && colAtivo !== 'S') continue;

            const display = (row[idxMenu] || '').trim();
            if (!display) continue;

            const prefixo = (row[idxPrefixo] || '').trim() || display;
            const tipoNorm = normalizarTextoPlanilha(row[idxTipo] || '');
            const labelPergunta = (row[idxRotulo] || '').trim();
            const subOpcoesRaw = (row[idxSubmenu] || '').trim();

            let item = {
                display: display,
                prefixo: prefixo,
                precisaExtra: false
            };

            if (tipoNorm.includes('DATA OU MOTIVO') || tipoNorm.includes('DATA/MOTIVO') || tipoNorm.includes('DATA MOTIVO')) {
                item.precisaExtra = true;
                item.tipoExtra = 'dataOuMotivo';
                item.labelExtra = labelPergunta || 'Data de Retorno e Motivo:';
                item.rotuloExtra = 'Info';
            } else if (tipoNorm.includes('DATA')) {
                item.precisaExtra = true;
                item.tipoExtra = 'data';
                item.labelExtra = labelPergunta || 'Informe a Data de Retorno:';
                item.rotuloExtra = 'Data de Retorno';
            } else if (tipoNorm.includes('LIVRE') || tipoNorm.includes('ABERTO') || tipoNorm.includes('TEXTO')) {
                item.precisaExtra = true;
                item.tipoExtra = 'texto';
                item.labelExtra = labelPergunta || 'Digite a observação:';
                item.rotuloExtra = ROTULOS_PADRAO[prefixo] || (labelPergunta.toUpperCase().includes('Nº') ? 'Nº' : '');
            } else if (tipoNorm.includes('SUBMENU') || display.toUpperCase().includes('SCGA')) {
                item.precisaScga = true;
                item.labelScga = labelPergunta || 'selecione o motivo pelo qual não é possível cumprir o pedido solicitado no SCGA:';
                if (subOpcoesRaw) {
                    item.subOpcoes = subOpcoesRaw.split(';').map(s => s.trim()).filter(Boolean);
                }
            }

            resultado.push(item);
        }

        return resultado.length > 0 ? resultado : null;
    }

    function carregarObservacoesPlanilha() {
        const { id, gid } = extrairIdEAbas(URL_PLANILHA_OBSERVACOES);
        if (!id) return;
        const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}&headers=0&_t=${Date.now()}`;
        console.log("😸 [Tontom] Carregando observações da planilha...", csvUrl);

        function processarResposta(csvTexto) {
            try {
                const matriz = parsearCSV(csvTexto);
                console.log("😸 [Tontom] CSV de observações recebido. Linhas:", matriz.length);
                const novas = processarObservacoesPlanilha(matriz);
                if (novas && novas.length > 0) {
                    console.log("😸 [Tontom] Observações carregadas com sucesso da planilha:", novas.length, "itens.");
                    opcoesObservacoesDinamicas = novas;
                    try {
                        localStorage.setItem('tontom_obs_cache_v1', JSON.stringify(novas));
                    } catch (e) {}
                    if (typeof callbackAtualizarMenuObservacoes === 'function') {
                        callbackAtualizarMenuObservacoes();
                    }
                } else {
                    console.warn("😸 [Tontom] Nenhuma observação ativa encontrada no CSV da planilha.");
                }
            } catch (err) {
                console.error('[Tontom] Erro ao processar observações da planilha:', err);
            }
        }

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: "GET",
                url: csvUrl,
                onload: function(response) {
                    if (response.status === 200) {
                        processarResposta(response.responseText);
                    } else {
                        console.warn("😸 [Tontom] Falha HTTP ao carregar observações:", response.status);
                    }
                },
                onerror: function(err) {
                    console.error("😸 [Tontom] Erro de rede ao carregar observações:", err);
                }
            });
        } else {
            fetch(csvUrl)
                .then(res => res.ok ? res.text() : Promise.reject())
                .then(processarResposta)
                .catch(err => console.error("😸 [Tontom] Erro fetch ao carregar observações:", err));
        }
    }

    function aplicarTagsNaTela() {
        if (BANCO_PRIORIDADES.size === 0) return;
        const regexNPU = /\b\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}\b/g;
        const elementos = document.querySelectorAll("td, span, a, div.ui-outputpanel");
        elementos.forEach(el => {
            // CRÍTICO: Evita injetar tags de prioridade repetidas dentro de qualquer parte do nosso próprio painel ou menu flutuante
            if (el.closest('#painelContadoresServidor') || el.closest('#containerMenuTontom')) return;
            if (el.querySelector(".tag-prioridade") || el.classList.contains("tag-prioridade")) return;

            if (el.childNodes.length > 0) {
                for (let node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE && regexNPU.test(node.nodeValue)) {
                        const correspondencias = node.nodeValue.match(regexNPU);
                        if (correspondencias) {
                            correspondencias.forEach(npuMatch => {
                                const chave = limparNPU(npuMatch);
                                if (BANCO_PRIORIDADES.has(chave)) {
                                    const pStr = BANCO_PRIORIDADES.get(chave); // ex: "4.1" ou "4"
                                    const pBase = parseInt(pStr, 10); // Extrai apenas a base inteira (ex: 4)

                                    const descPrio = BANCO_PRIO_DESC.get(chave);
                                    const tag = document.createElement("span");
                                    tag.className = `tag-prioridade prio-p${pBase}`; // Usa a cor do grupo base
                                    // Prioridades do SCGA mostram número + descrição (ex: "P1-Tutela/Liminar")
                                    tag.textContent = descPrio ? `P${pStr}-${descPrio}` : `P-${pStr}`; // Adiciona o tracinho separador

                                    tag.title = descPrio ? `Prioridade Nível P${pStr} - ${descPrio}` : `Prioridade Nível P${pStr}`;
                                    el.appendChild(tag);

                                    // Tag especial da planilha (Saldo / INCON), ao lado da prioridade
                                    const tagEspecial = BANCO_TAGS_ESPECIAIS.get(chave);
                                    if (tagEspecial) {
                                        const tagEspNode = document.createElement("span");
                                        const classeTipo = tagEspecial.startsWith("Saldo") ? "tag-saldo" : "tag-incon";
                                        tagEspNode.className = `tag-prioridade ${classeTipo}`;
                                        tagEspNode.textContent = tagEspecial;
                                        tagEspNode.title = tagEspecial;
                                        el.appendChild(tagEspNode);
                                    }

                                    // Tag amarela SCGA, quando a célula da planilha traz [SCGA]
                                    if (BANCO_SCGA.has(chave)) {
                                        const tagScgaNode = document.createElement("span");
                                        tagScgaNode.className = "tag-prioridade tag-scga";
                                        tagScgaNode.textContent = "SCGA";
                                        tagScgaNode.title = "SCGA";
                                        el.appendChild(tagScgaNode);
                                    }
                                }
                            });
                        }
                    }
                }
            }
        });
    }

    function childText(el) {
        return el.innerText ? el.innerText.trim() : "";
    }

    // ==========================================
    // ==========================================
    // PARTE 2: LÓGICA DO MENU DE OBSERVAÇÕES
    // ==========================================

    const opcoesPadrao = [
        { display: "SUPERVISÃO/DÚVIDA (campo aberto)", prefixo: "SUPERVISÃO/DÚVIDA", precisaExtra: true, labelExtra: "Digite o motivo ou a dúvida:", rotuloExtra: "Detalhe" },
        { display: "*SERVIDOR (campo aberto)", prefixo: "*SERVIDOR", precisaExtra: true, labelExtra: "Digite o lembrete/observação interna:", rotuloExtra: "Lembrete" },
        { display: "*SISCONDJ (Alvará gravado)", prefixo: "*SISCONDJ (Alvará gravado)", precisaExtra: false },
        { display: "*SISCONDJ (Vinculação de Conta)", prefixo: "*SISCONDJ (Vinculação de Conta)", precisaExtra: false },
        { display: "*SISCONDJ - valor indisponível SISBAJUD", prefixo: "*SISCONDJ - valor indisponível SISBAJUD", precisaExtra: false },
        { display: "*PRAZO ABERTO FORA DO SISTEMA (Data de Retorno)", prefixo: "*PRAZO ABERTO FORA DO SISTEMA", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno", tipoExtra: "data" },
        { display: "*PRAZO EM CURSO NO SISTEMA", prefixo: "*PRAZO EM CURSO NO SISTEMA", precisaExtra: false },
        { display: "*PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação - informar nº)", prefixo: "*PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação)", precisaExtra: true, labelExtra: "Informe o Nº do Tema/Ação Conexa:", rotuloExtra: "Nº" },
        { display: "*PROCESSO SUSPENSO (Determinação judicial - informar data de retorno)", prefixo: "*PROCESSO SUSPENSO (Determinação judicial)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno", tipoExtra: "data" },
        { display: "*PROCESSO SUSPENSO (Data de Retorno)", prefixo: "*PROCESSO SUSPENSO (Data de Retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno", tipoExtra: "data" },
        { display: "*PROCESSO SUSPENSO (Resposta de Precatória - PC 03/2021)", prefixo: "*PROCESSO SUSPENSO (Resposta de Precatória - PC 03/2021)", precisaExtra: false },
        { display: "*PROCESSO SUSPENSO (Julg. Agravo/Conflito de competência - informar nº)", prefixo: "*PROCESSO SUSPENSO (Julg. Agravo/Conflito de competência)", precisaExtra: true, labelExtra: "Informe o Nº do processo:", rotuloExtra: "Nº" },
        { display: "*PROCESSO SUSPENSO (Até ulterior deliberação - Sem data de retorno)", prefixo: "*PROCESSO SUSPENSO (Até ulterior deliberação - Sem data de retorno)", precisaExtra: false },
        { display: "*ARQUIVO PROVISÓRIO (Data de retorno OU Motivo)", prefixo: "*ARQUIVO PROVISÓRIO", precisaExtra: true, tipoExtra: "dataOuMotivo", labelExtra: "Informe a Data ou Motivo:", rotuloExtra: "Info" },
        { display: "*ARQUIVO DEFINITIVO", prefixo: "*ARQUIVO DEFINITIVO", precisaExtra: false },
        { display: "*ERRO DE FLUXO (Nº do Chamado ou Falha na Migração)", prefixo: "*ERRO DE FLUXO", precisaExtra: true, labelExtra: "Informe o Nº do Chamado ou escreva falha na migração:", rotuloExtra: "Chamado" },
        { display: "*LEILÃO", prefixo: "*LEILÃO", precisaExtra: false },
        { display: "*REC. JUD./FALÊNCIA (não engloba habilitação de crédito)", prefixo: "*REC. JUD./FALÊNCIA (não engloba habilitação de crédito)", precisaExtra: false },
        { display: "*PRECATÓRIO/RPV", prefixo: "*PRECATÓRIO/RPV", precisaExtra: false },
        { display: "*CENTRAL DE AGILIZAÇÃO (SEM FLUXO)", prefixo: "*CENTRAL DE AGILIZAÇÃO (SEM FLUXO)", precisaExtra: false },
        { display: "*INTEGRALMENTE CUMPRIDO POR OUTRO SERVIDOR", prefixo: "*INTEGRALMENTE CUMPRIDO POR OUTRO SERVIDOR", precisaExtra: false },
        { display: "SCGA-Em desacordo com a IS", prefixo: "SCGA-Em desacordo com a IS", precisaScga: true }
    ];

    // Motivos do submenu "SCGA-Em desacordo com a IS"
    const MOTIVO_SCGA_OUTROS = "Outros motivos:";
    const MOTIVOS_SCGA_IS = [
        "Proc. com prazo aberto",
        'Proc. em tarefa de Gabinete/Contadoria (exceto pedido de "outras certidões" e "hab. de advogado")',
        "Processo está no 2º grau",
        "solicitação não atendida- despacho sequenciado ou outros cumprimentos pela diretoria",
        "Proc. não sigiloso (adv. pode fazer a própria habilitação no sist. PJe)"
    ];

    // Cria um campo de busca (com lupa) que filtra, enquanto o servidor digita, as opções de um <select> existente.
    // Ao escolher uma opção da lista, o <select> recebe o valor e dispara o evento "change" (a lógica atual continua valendo).
    function criarBuscaParaSelect(selectEl, placeholder) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom: 6px;';

        const campo = document.createElement('div');
        campo.style.cssText = 'display: flex; align-items: center; border: 1px solid #ced4da; border-radius: 4px; background: #fff; padding: 0 8px;';

        const lupa = document.createElement('span');
        lupa.textContent = '🔍';
        lupa.style.cssText = 'font-size: 13px; margin-right: 6px; cursor: pointer; user-select: none;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.setAttribute('autocomplete', 'off');
        input.style.cssText = 'flex: 1; border: none; outline: none; padding: 6px 0; font-size: 13px; background: transparent; min-width: 0;';

        const lista = document.createElement('div');
        lista.style.cssText = 'display: none; margin-top: 2px; max-height: 220px; overflow-y: auto; background: #fff; border: 1px solid #ced4da; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,.15);';

        campo.appendChild(lupa);
        campo.appendChild(input);
        wrap.appendChild(campo);
        wrap.appendChild(lista);

        let itens = [];
        let ativo = -1;

        function fechar() {
            lista.style.display = 'none';
            ativo = -1;
        }

        function destacar() {
            itens.forEach((el, i) => {
                el.style.background = i === ativo ? '#0d6efd' : '#fff';
                el.style.color = i === ativo ? '#fff' : '#212529';
            });
            if (ativo >= 0 && itens[ativo]) itens[ativo].scrollIntoView({ block: 'nearest' });
        }

        function escolher(valor) {
            input.value = '';
            fechar();
            selectEl.value = valor;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function atualizar() {
            lista.innerHTML = '';
            itens = [];
            ativo = -1;

            const tokens = normalizarTextoPlanilha(input.value).split(' ').filter(Boolean);
            if (tokens.length === 0) { fechar(); return; }

            const achadas = Array.from(selectEl.options).filter(o => {
                if (o.value === '') return false;
                const textoNorm = normalizarTextoPlanilha(o.text);
                return tokens.every(t => textoNorm.includes(t));
            });

            if (achadas.length === 0) {
                const vazio = document.createElement('div');
                vazio.textContent = 'Nenhuma opção encontrada';
                vazio.style.cssText = 'padding: 6px 10px; font-size: 12px; color: #6c757d; font-style: italic;';
                lista.appendChild(vazio);
            } else {
                achadas.forEach(o => {
                    const item = document.createElement('div');
                    item.textContent = o.text;
                    item.style.cssText = 'padding: 6px 10px; font-size: 13px; cursor: pointer; background: #fff; color: #212529;';
                    item.dataset.valor = o.value;
                    // mousedown (e não click) para o campo não perder o foco antes da seleção
                    item.addEventListener('mousedown', function(e) {
                        e.preventDefault();
                        escolher(item.dataset.valor);
                    });
                    item.addEventListener('mouseover', function() {
                        ativo = itens.indexOf(item);
                        destacar();
                    });
                    lista.appendChild(item);
                    itens.push(item);
                });
                ativo = 0;
                destacar();
            }
            lista.style.display = 'block';
        }

        input.addEventListener('input', atualizar);
        input.addEventListener('focus', atualizar);
        input.addEventListener('blur', function() { setTimeout(fechar, 150); });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (itens.length) { ativo = (ativo + 1) % itens.length; destacar(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (itens.length) { ativo = (ativo - 1 + itens.length) % itens.length; destacar(); }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (ativo >= 0 && itens[ativo]) escolher(itens[ativo].dataset.valor);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation(); // evita fechar a janela do SIMAP ao cancelar apenas a busca
                input.value = '';
                fechar();
            }
        });
        lupa.addEventListener('click', function() { input.focus(); });

        return {
            elemento: wrap,
            limpar: function() { input.value = ''; fechar(); },
            focar: function() { input.focus(); }
        };
    }

    let textoPrevioAoSelect = "";

    function injetarMenuFlutuante() {
        const txtAreaOriginal = document.getElementById('field_observacao');
        if (!txtAreaOriginal || document.getElementById('containerMenuTontom')) return;

        // Detecta se a servidora Thamyris Ferreira Santos está logada
        const docText = document.body.innerText || "";
        const isThamyris = docText.includes("THAMYRIS FERREIRA") || docText.includes("Thamyris Ferreira") || docText.includes("thamyris ferreira");

        const listaInicial = (opcoesObservacoesDinamicas && opcoesObservacoesDinamicas.length > 0)
            ? opcoesObservacoesDinamicas
            : opcoesPadrao;

        let opcoesMenu = [];

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

        const buscaObs = criarBuscaParaSelect(select, 'Buscar observação... (ex: SISC)');

        function popularSelect(lista) {
            opcoesMenu = [...lista];
            if (isThamyris) {
                opcoesMenu.push({
                    display: "*IMPEDIMENTO DO CUMPRIMENTO (selecionar tipo)",
                    prefixo: "*IMPEDIMENTO DO CUMPRIMENTO",
                    precisaImpedimento: true
                });
            }
            select.innerHTML = '';
            const optDefault = document.createElement('option');
            optDefault.value = '';
            optDefault.innerText = '-- Escolha uma opção (Opcional) --';
            select.appendChild(optDefault);

            opcoesMenu.forEach((opt, index) => {
                const o = document.createElement('option');
                o.value = index;
                o.innerText = opt.display;
                select.appendChild(o);
            });
            buscaObs.limpar();
        }

        popularSelect(listaInicial);

        callbackAtualizarMenuObservacoes = function() {
            if (document.getElementById('containerMenuTontom') && opcoesObservacoesDinamicas) {
                popularSelect(opcoesObservacoesDinamicas);
            }
        };

        container.appendChild(buscaObs.elemento);
        container.appendChild(select);

        // Div de texto extra (ex: chamados, datas)
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

        // Função de validação de data dd/mm/aaaa
        function validarDataDDMMAAAA(valor) {
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) return false;
            const partes = valor.split('/');
            const dia = parseInt(partes[0], 10);
            const mes = parseInt(partes[1], 10);
            const ano = parseInt(partes[2], 10);
            if (mes < 1 || mes > 12) return false;
            if (dia < 1 || dia > 31) return false;
            if (ano < 1900 || ano > 2100) return false;
            const dataObj = new Date(ano, mes - 1, dia);
            return dataObj.getFullYear() === ano && dataObj.getMonth() === mes - 1 && dataObj.getDate() === dia;
        }

        // Função de máscara de data dd/mm/aaaa
        function aplicarMascaraData(input) {
            input.addEventListener('input', function(e) {
                let val = this.value.replace(/\D/g, '');
                if (val.length > 8) val = val.substring(0, 8);
                if (val.length >= 5) {
                    this.value = val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4);
                } else if (val.length >= 3) {
                    this.value = val.substring(0, 2) + '/' + val.substring(2);
                } else {
                    this.value = val;
                }
            });
        }

        // Função para mostrar/esconder erro de data
        function mostrarErroData(inputEl, erroEl, valido) {
            if (valido) {
                inputEl.style.borderColor = '#ced4da';
                erroEl.style.display = 'none';
            } else {
                inputEl.style.borderColor = '#dc3545';
                erroEl.style.display = 'block';
            }
        }

        // Elemento de erro para data no inputExtra
        const erroData = document.createElement('span');
        erroData.style.cssText = 'display: none; color: #dc3545; font-size: 11px; margin-top: 2px;';
        erroData.innerText = 'Data inválida. Use o formato dd/mm/aaaa.';

        divExtra.appendChild(labelExtra);
        divExtra.appendChild(inputExtra);
        divExtra.appendChild(erroData);
        container.appendChild(divExtra);

        // Div extra para ARQUIVO PROVISÓRIO (dataOuMotivo) — dois campos
        const divDataOuMotivo = document.createElement('div');
        divDataOuMotivo.id = 'divDataOuMotivoTontom';
        divDataOuMotivo.style.cssText = 'display: none; margin-top: 8px;';

        const labelDataDM = document.createElement('label');
        labelDataDM.innerText = 'Data de Retorno:';
        labelDataDM.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 3px; color: #495057;';

        const inputDataDM = document.createElement('input');
        inputDataDM.id = 'inputDataDMTontom';
        inputDataDM.type = 'text';
        inputDataDM.placeholder = 'dd/mm/aaaa';
        inputDataDM.maxLength = 10;
        inputDataDM.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; margin-bottom: 4px;';
        aplicarMascaraData(inputDataDM);

        const erroDataDM = document.createElement('span');
        erroDataDM.style.cssText = 'display: none; color: #dc3545; font-size: 11px; margin-top: 2px;';
        erroDataDM.innerText = 'Data inválida. Use o formato dd/mm/aaaa.';

        const labelMotivoDM = document.createElement('label');
        labelMotivoDM.innerText = 'Motivo:';
        labelMotivoDM.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 3px; margin-top: 8px; color: #495057;';

        const inputMotivoDM = document.createElement('input');
        inputMotivoDM.id = 'inputMotivoDMTontom';
        inputMotivoDM.type = 'text';
        inputMotivoDM.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;';

        divDataOuMotivo.appendChild(labelDataDM);
        divDataOuMotivo.appendChild(inputDataDM);
        divDataOuMotivo.appendChild(erroDataDM);
        divDataOuMotivo.appendChild(labelMotivoDM);
        divDataOuMotivo.appendChild(inputMotivoDM);
        container.appendChild(divDataOuMotivo);

        // Div extra de Impedimento (Exclusivo Thamyris)
        const divImpedimento = document.createElement('div');
        divImpedimento.id = 'divImpedimentoTontom';
        divImpedimento.style.cssText = 'display: none; margin-top: 8px;';

        const labelImp = document.createElement('label');
        labelImp.innerText = 'Selecione o tipo de Impedimento:';
        labelImp.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 3px; color: #495057;';

        const selectImp = document.createElement('select');
        selectImp.id = 'selectImpedimentoTontom';
        selectImp.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; background-color: #fff; cursor: pointer;';

        const impedimentos = ["-- Selecione o Impedimento --", "ALVARÁ", "SICAJUD", "MALOTE", "MANDADO", "OUTROS"];
        impedimentos.forEach(imp => {
            const opt = document.createElement('option');
            opt.value = imp.startsWith("--") ? "" : imp;
            opt.innerText = imp;
            selectImp.appendChild(opt);
        });

        divImpedimento.appendChild(labelImp);
        divImpedimento.appendChild(selectImp);
        container.appendChild(divImpedimento);

        // Div extra de "SCGA-Em desacordo com a IS": busca + submenu de motivos + campo livre para "Outros motivos:"
        const divScga = document.createElement('div');
        divScga.id = 'divScgaTontom';
        divScga.style.cssText = 'display: none; margin-top: 8px;';

        const labelScga = document.createElement('label');
        labelScga.innerText = 'selecione o motivo pelo qual não é possível cumprir o pedido solicitado no SCGA:';
        labelScga.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 3px; color: #495057;';

        const selectScga = document.createElement('select');
        selectScga.id = 'selectScgaTontom';
        selectScga.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; background-color: #fff; cursor: pointer;';

        const optScgaDefault = document.createElement('option');
        optScgaDefault.value = '';
        optScgaDefault.innerText = '-- Selecione o motivo --';
        selectScga.appendChild(optScgaDefault);
        MOTIVOS_SCGA_IS.forEach(motivo => {
            const opt = document.createElement('option');
            opt.value = motivo;
            opt.innerText = motivo;
            selectScga.appendChild(opt);
        });

        const buscaScga = criarBuscaParaSelect(selectScga, 'Buscar motivo...');

        const divScgaOutros = document.createElement('div');
        divScgaOutros.style.cssText = 'display: none; margin-top: 8px;';

        const labelScgaOutros = document.createElement('label');
        labelScgaOutros.innerText = 'Descreva o motivo pelo qual o pedido está em desacordo com a IS:';
        labelScgaOutros.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 3px; color: #495057;';

        const inputScgaOutros = document.createElement('input');
        inputScgaOutros.type = 'text';
        inputScgaOutros.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px;';

        divScgaOutros.appendChild(labelScgaOutros);
        divScgaOutros.appendChild(inputScgaOutros);

        divScga.appendChild(labelScga);
        divScga.appendChild(buscaScga.elemento);
        divScga.appendChild(selectScga);
        divScga.appendChild(divScgaOutros);
        container.appendChild(divScga);
        txtAreaOriginal.parentNode.insertBefore(container, txtAreaOriginal);

        // --- Sincronização do Checkbox de Notificação (Tontom) ---
        function obterCheckboxNotificar() {
            const labels = Array.from(document.querySelectorAll('label, span, div'));
            const labelNotif = labels.find(el => el.innerText && el.innerText.trim().includes('Notificar Supervisão/Servidor'));
            if (labelNotif) {
                const pCheckbox = labelNotif.closest('p-checkbox');
                if (pCheckbox) {
                    return pCheckbox.querySelector('input[type="checkbox"]') || pCheckbox;
                }
                const parent = labelNotif.parentElement;
                if (parent) {
                    return parent.querySelector('input[type="checkbox"]') || parent.querySelector('.p-checkbox-box') || parent;
                }
            }
            return document.querySelector('p-checkbox input[type="checkbox"]') || document.querySelector('input[type="checkbox"]');
        }

        function isCheckboxChecked(chk) {
            if (!chk) return false;
            if (chk.tagName === 'INPUT') {
                return chk.checked;
            }
            const box = chk.querySelector('.p-checkbox-box') || chk;
            return box.classList.contains('p-highlight') || box.getAttribute('aria-checked') === 'true' || chk.checked;
        }

        function setCheckboxChecked(chk, state) {
            if (!chk) return;
            const input = chk.tagName === 'INPUT' ? chk : chk.querySelector('input[type="checkbox"]');
            if (input) {
                if (input.checked !== state) {
                    input.click();
                }
            } else {
                const box = chk.querySelector('.p-checkbox-box') || chk;
                const isCurrentlyChecked = box.classList.contains('p-highlight') || box.getAttribute('aria-checked') === 'true';
                if (isCurrentlyChecked !== state) {
                    box.click();
                }
            }
        }

        // Inicialização: Se a observação já possui a tag [NOTIFICADO] salva no texto
        setTimeout(() => {
            const chk = obterCheckboxNotificar();
            let texto = txtAreaOriginal.value;
            if (texto.includes('[NOTIFICADO]')) {
                setCheckboxChecked(chk, true);
                txtAreaOriginal.value = texto.replace(/[\s]*\[NOTIFICADO\]/g, '').trim();
                dispararEventos(txtAreaOriginal);
            }
        }, 400);

        // Intercepta o clique no botão Salvar para embutir [NOTIFICADO] se marcado
        const btnSalvar = Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.includes('Salvar') || btn.textContent.includes('Salvar'));
        if (btnSalvar) {
            btnSalvar.addEventListener('click', function(e) {
                const chk = obterCheckboxNotificar();
                const isChecked = isCheckboxChecked(chk);
                let texto = txtAreaOriginal.value.trim();

                texto = texto.replace(/[\s]*\[NOTIFICADO\]/g, '').trim();
                if (isChecked) {
                    txtAreaOriginal.value = (texto + " [NOTIFICADO]").trim();
                } else {
                    txtAreaOriginal.value = texto;
                }
                dispararEventos(txtAreaOriginal);
            }, true); // Capturando (executa antes dos listeners de bubbling do Angular)
        }

        // Função auxiliar para esconder todos os painéis extras
        function esconderTodosExtras() {
            divExtra.style.display = 'none';
            inputExtra.value = '';
            inputExtra.type = 'text';
            inputExtra.removeAttribute('placeholder');
            inputExtra.removeAttribute('maxlength');
            inputExtra.style.borderColor = '#ced4da';
            erroData.style.display = 'none';
            divDataOuMotivo.style.display = 'none';
            inputDataDM.value = '';
            inputDataDM.style.borderColor = '#ced4da';
            erroDataDM.style.display = 'none';
            inputMotivoDM.value = '';
            divImpedimento.style.display = 'none';
            selectImp.value = '';
            divScga.style.display = 'none';
            selectScga.value = '';
            buscaScga.limpar();
            divScgaOutros.style.display = 'none';
            inputScgaOutros.value = '';
        }

        // Lógica de seleção do menu padronizado
        select.addEventListener('change', function() {
            const idx = this.value;
            if (idx === '') {
                esconderTodosExtras();
                return;
            }

            const opcaoSelecionada = opcoesMenu[idx];
            textoPrevioAoSelect = txtAreaOriginal.value.trim();

            // Lógica do SCGA-Em desacordo com a IS (submenu de motivos)
            if (opcaoSelecionada.precisaScga) {
                esconderTodosExtras();
                divScga.style.display = 'block';

                if (opcaoSelecionada.labelScga) {
                    labelScga.innerText = opcaoSelecionada.labelScga;
                }

                const motivosAtuais = (opcaoSelecionada.subOpcoes && opcaoSelecionada.subOpcoes.length > 0)
                    ? opcaoSelecionada.subOpcoes
                    : MOTIVOS_SCGA_IS;

                selectScga.innerHTML = '';
                const optScgaDefault = document.createElement('option');
                optScgaDefault.value = '';
                optScgaDefault.innerText = '-- Selecione o motivo --';
                selectScga.appendChild(optScgaDefault);
                motivosAtuais.forEach(motivo => {
                    const opt = document.createElement('option');
                    opt.value = motivo;
                    opt.innerText = motivo;
                    selectScga.appendChild(opt);
                });

                selectScga.value = '';
                buscaScga.limpar();
                buscaScga.focar();
                acumularTextoOficial(opcaoSelecionada.prefixo);
            }
            // Lógica do Impedimento (Thamyris)
            else if (opcaoSelecionada.precisaImpedimento) {
                esconderTodosExtras();
                divImpedimento.style.display = 'block';
                selectImp.value = '';
                selectImp.focus();
                acumularTextoOficial(opcaoSelecionada.prefixo);
            }
            // Lógica do campo de data + motivo (ARQUIVO PROVISÓRIO)
            else if (opcaoSelecionada.tipoExtra === 'dataOuMotivo') {
                esconderTodosExtras();
                divDataOuMotivo.style.display = 'block';
                inputDataDM.value = '';
                inputMotivoDM.value = '';
                inputDataDM.focus();
                acumularTextoOficial(opcaoSelecionada.prefixo);
            }
            // Lógica do campo de data formatado
            else if (opcaoSelecionada.tipoExtra === 'data') {
                esconderTodosExtras();
                labelExtra.innerText = opcaoSelecionada.labelExtra;
                divExtra.style.display = 'block';
                inputExtra.type = 'text';
                inputExtra.placeholder = 'dd/mm/aaaa';
                inputExtra.maxLength = 10;
                inputExtra.value = '';
                inputExtra.focus();
                acumularTextoOficial(opcaoSelecionada.prefixo);
            }
            // Lógica do Campo Aberto (Normal)
            else if (opcaoSelecionada.precisaExtra) {
                esconderTodosExtras();
                labelExtra.innerText = opcaoSelecionada.labelExtra;
                divExtra.style.display = 'block';
                inputExtra.removeAttribute('maxlength');
                inputExtra.removeAttribute('placeholder');
                inputExtra.value = '';
                inputExtra.focus();
                acumularTextoOficial(opcaoSelecionada.prefixo);
            }
            // Opções Simples
            else {
                esconderTodosExtras();
                const textoFinal = opcaoSelecionada.cleanText || opcaoSelecionada.prefixo;
                acumularTextoOficial(textoFinal);
                select.value = '';
            }
        });

        // Lógica do campo aberto texto / data
        inputExtra.addEventListener('input', function() {
            const idx = select.value;
            if (idx === '') return;

            const opcaoSelecionada = opcoesMenu[idx];

            if (opcaoSelecionada.tipoExtra === 'data') {
                let val = this.value.replace(/\D/g, '');
                if (val.length > 8) val = val.substring(0, 8);
                if (val.length >= 5) {
                    this.value = val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4);
                } else if (val.length >= 3) {
                    this.value = val.substring(0, 2) + '/' + val.substring(2);
                } else {
                    this.value = val;
                }

                if (this.value.length === 10) {
                    const valido = validarDataDDMMAAAA(this.value);
                    mostrarErroData(inputExtra, erroData, valido);
                    if (valido) {
                        const textoTermo = `${opcaoSelecionada.prefixo} | ${opcaoSelecionada.rotuloExtra}: ${this.value}`;
                        substituirTextoTemporario(textoTermo);
                    } else {
                        substituirTextoTemporario(opcaoSelecionada.prefixo);
                    }
                } else {
                    inputExtra.style.borderColor = '#ced4da';
                    erroData.style.display = 'none';
                    substituirTextoTemporario(opcaoSelecionada.prefixo);
                }
            } else {
                const infoAdicional = this.value.trim();
                let textoTermo;
                if (!infoAdicional) {
                    textoTermo = opcaoSelecionada.prefixo;
                } else if (opcaoSelecionada.rotuloExtra) {
                    textoTermo = `${opcaoSelecionada.prefixo} | ${opcaoSelecionada.rotuloExtra}: ${infoAdicional}`;
                } else {
                    textoTermo = `${opcaoSelecionada.prefixo} | ${infoAdicional}`;
                }
                substituirTextoTemporario(textoTermo);
            }
        });

        inputExtra.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const idx = select.value;
                if (idx !== '') {
                    const opc = opcoesMenu[idx];
                    if (opc.tipoExtra === 'data' && inputExtra.value.length === 10 && !validarDataDDMMAAAA(inputExtra.value)) {
                        return;
                    }
                }
                select.value = '';
                divExtra.style.display = 'none';
                inputExtra.value = '';
                inputExtra.style.borderColor = '#ced4da';
                erroData.style.display = 'none';
                txtAreaOriginal.focus();
            }
        });

        // Handler para os campos de ARQUIVO PROVISÓRIO (dataOuMotivo)
        function atualizarTextoDataOuMotivo() {
            const idx = select.value;
            if (idx === '') return;
            const opcaoSelecionada = opcoesMenu[idx];
            const dataVal = inputDataDM.value.trim();
            const motivoVal = inputMotivoDM.value.trim();

            if (dataVal.length === 10) {
                const valido = validarDataDDMMAAAA(dataVal);
                mostrarErroData(inputDataDM, erroDataDM, valido);
                if (!valido) {
                    substituirTextoTemporario(opcaoSelecionada.prefixo);
                    return;
                }
            } else {
                inputDataDM.style.borderColor = '#ced4da';
                erroDataDM.style.display = 'none';
            }

            let partes = [];
            if (dataVal.length === 10 && validarDataDDMMAAAA(dataVal)) {
                partes.push(`Data de Retorno: ${dataVal}`);
            }
            if (motivoVal) {
                partes.push(`Motivo: ${motivoVal}`);
            }

            const textoTermo = partes.length > 0 ? `${opcaoSelecionada.prefixo} | ${partes.join(' | ')}` : opcaoSelecionada.prefixo;
            substituirTextoTemporario(textoTermo);
        }

        inputDataDM.addEventListener('input', atualizarTextoDataOuMotivo);
        inputMotivoDM.addEventListener('input', atualizarTextoDataOuMotivo);

        inputDataDM.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (inputDataDM.value.length === 10 && !validarDataDDMMAAAA(inputDataDM.value)) return;
                inputMotivoDM.focus();
            }
        });

        inputMotivoDM.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (inputDataDM.value.length === 10 && !validarDataDDMMAAAA(inputDataDM.value)) return;
                select.value = '';
                divDataOuMotivo.style.display = 'none';
                inputDataDM.value = '';
                inputMotivoDM.value = '';
                txtAreaOriginal.focus();
            }
        });

        // Lógica de seleção do motivo "SCGA-Em desacordo com a IS"
        function finalizarSelecaoScga() {
            select.value = '';
            divScga.style.display = 'none';
            selectScga.value = '';
            buscaScga.limpar();
            divScgaOutros.style.display = 'none';
            inputScgaOutros.value = '';
            txtAreaOriginal.focus();
        }

        selectScga.addEventListener('change', function() {
            const val = this.value;
            const opcaoSelecionada = opcoesMenu[select.value];
            if (!opcaoSelecionada || !opcaoSelecionada.precisaScga) return;

            if (!val) {
                divScgaOutros.style.display = 'none';
                inputScgaOutros.value = '';
                substituirTextoTemporario(opcaoSelecionada.prefixo);
                return;
            }

            // "Outros motivos:" abre um campo livre para o servidor escrever o motivo
            if (val === MOTIVO_SCGA_OUTROS) {
                divScgaOutros.style.display = 'block';
                inputScgaOutros.value = '';
                inputScgaOutros.focus();
                substituirTextoTemporario(opcaoSelecionada.prefixo);
                return;
            }

            divScgaOutros.style.display = 'none';
            inputScgaOutros.value = '';
            substituirTextoTemporario(`${opcaoSelecionada.prefixo} | Motivo: ${val}`);
            finalizarSelecaoScga();
        });

        inputScgaOutros.addEventListener('input', function() {
            const opcaoSelecionada = opcoesMenu[select.value];
            if (!opcaoSelecionada || !opcaoSelecionada.precisaScga) return;
            const motivoLivre = this.value.trim();
            substituirTextoTemporario(motivoLivre ? `${opcaoSelecionada.prefixo} | Motivo: ${motivoLivre}` : opcaoSelecionada.prefixo);
        });

        inputScgaOutros.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                finalizarSelecaoScga();
            }
        });

        // Lógica de seleção do sub-impedimento (Thamyris)
        selectImp.addEventListener('change', function() {
            const val = this.value;
            if (!val) return;

            const opcaoSelecionada = opcoesMenu[select.value];
            const textoFinal = `${opcaoSelecionada.prefixo} | Motivo: ${val}`;
            substituirTextoTemporario(textoFinal);

            // Conclui a seleção
            select.value = '';
            divImpedimento.style.display = 'none';
            txtAreaOriginal.focus();
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


    // ==========================================
    // PARTE 3: PAINEL E VARREDURA DO SERVIDOR
    // ==========================================

    function esperar(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function criarControlesServidor() {
        if (document.getElementById("tontomControlesServidor")) return true;

        const ths = Array.from(document.querySelectorAll('th')).map(th => th.innerText.toUpperCase());
        const eTelaValida = ths.some(t => t.includes("PROCESSO") || t.includes("STATUS") || t.includes("NPU"));
        if (!eTelaValida) return false;

        const container = document.createElement("div");
        container.id = "tontomControlesServidor";
        container.style.cssText = `
            position:fixed; top:10px; left:180px; z-index:9999;
            background:#fff; padding:5px 10px; border:1px solid #ccc;
            border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,.15);
            display: flex; align-items: center; height: 32px; gap: 6px;
        `;

        const btnCarregar = document.createElement("button");
        btnCarregar.id = "btnGerarContadores";
        btnCarregar.innerText = "📊 Gerar Contadores";
        btnCarregar.title = "Varre todas as páginas para gerar estatísticas e a Fila de Trabalho consolidada.";
        btnCarregar.style.cssText = "padding: 3px 8px; cursor: pointer; font-weight: bold; font-size: 13px; background: #0d6efd; color: white; border: 1px solid #0a58ca; border-radius: 4px;";
        btnCarregar.onclick = rodarVarreduraServidor;

        const btnPause = document.createElement("button");
        btnPause.id = "btnServidorPause";
        btnPause.innerText = "⏸️";
        btnPause.disabled = true;
        btnPause.style.cssText = "padding: 3px 10px; cursor: pointer; font-weight: bold; font-size: 13px; border-radius: 4px; border:1px solid #ccc; background:#e9ecef; color:#333;";
        btnPause.onclick = alternarPausaServidor;

        container.appendChild(btnCarregar);
        container.appendChild(btnPause);
        document.body.appendChild(container);
        return true;
    }

    function criarPainelServidor() {
        if (document.getElementById("painelContadoresServidor")) return;

        const div = document.createElement("div");
        div.id = "painelContadoresServidor";
        div.style.cssText = `
            position:fixed; top:75px; left:180px; width:640px;
            background:#fff; border:1px solid #ccc; padding:10px; z-index:9999;
            border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,.2);
            display:none; font-family: sans-serif;
        `;
        document.body.appendChild(div);

        // Inicializa com a última posição salva (antes de chamar tornarElementoArrastavel)
        const salvoTop = localStorage.getItem('painelContadoresServidor_top');
        const salvoLeft = localStorage.getItem('painelContadoresServidor_left');
        if (salvoTop && salvoLeft) {
            div.style.top = salvoTop;
            div.style.left = salvoLeft;
        }
    }

    function renderizarEstruturaPainel() {
        const painel = document.getElementById("painelContadoresServidor");
        if (!painel) return;

        painel.innerHTML = `
            <div id="cabecalhoPainelServidor" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-bottom: 8px; cursor: move; user-select: none;">
                <h3 style="margin: 0; font-size: 14px; font-weight: bold; color: #222;">📊 Meus Contadores - SIMAP</h3>
                <div style="display: flex; gap: 6px;">
                    <button id="btnMinimizarPainelSrv" style="padding: 2px 6px; cursor: pointer; border: 1px solid #999; background: #eee; border-radius: 4px; font-weight: bold; font-size: 11px;">➖ Minimizar</button>
                    <button id="btnFecharPainelSrv" style="padding: 2px 6px; cursor: pointer; border: 1px solid #dc3545; background: #dc3545; color: #fff; border: none; border-radius: 4px; font-weight: bold; font-size: 11px;">❌ Fechar</button>
                </div>
            </div>
            <div id="conteudoPainelServidor">
                <table border="1" style="border-collapse:collapse; width:100%; text-align: center; font-size: 13px;">
                    <tr style="background: #e9ecef; font-weight: bold;">
                        <th style="padding: 6px; width: 70px;">Total Geral</th>
                        <th style="width: 85px; color: #157347;">Finalizados</th>
                        <th style="width: 105px; color: #0d6efd;">Em andamento</th>
                        <th style="width: 90px; color: #b02a37;">Pendentes</th>
                        <th style="width: 70px;">% Fin.</th>
                        <th style="width: 100px; color: #dc3545;">📖 Notificação</th>
                    </tr>
                    <tr>
                        <td id="srv-total" style="font-weight: bold; padding: 6px;">-</td>
                        <td id="srv-fin" style="color: #157347;">-</td>
                        <td id="srv-and" style="color: #0d6efd;">-</td>
                        <td id="srv-pen" style="color: #b02a37;">-</td>
                        <td id="srv-pct">-</td>
                        <td id="srv-notif" style="color: #dc3545;">-</td>
                    </tr>
                </table>

                <div id="btnTogglePrioridades" style="cursor:pointer; text-align:center; background:#f1f3f5; margin-top:10px; padding:6px; border:1px solid #ced4da; border-radius:4px; font-size:12px; font-weight:bold; color:#495057; user-select:none;">
                    ➕ Mostrar Detalhamento por Prioridades (P1 a P4)
                </div>

                <div id="wrapperPrioridades" style="display: none; margin-top: 8px; border-top: 1px dotted #ccc; padding-top: 8px;">
                    <table border="1" style="border-collapse:collapse; width:100%; text-align: center; font-size: 12px;">
                        <tr style="background: #f8f9fa; font-weight: bold;">
                            <th style="padding: 4px; width: 45px;">Prio</th>
                            <th style="width: 45px;">Total</th>
                            <th style="width: 50px; color: #157347;">Fin</th>
                            <th style="width: 60px; color: #0d6efd;">Andam</th>
                            <th style="width: 50px; color: #b02a37;">Pend</th>
                            <th style="width: 45px; color: #dc3545;">📖 Notif</th>
                            <th style="width: 250px; color: #d63384; text-align: left; padding-left: 6px;">Situação do Lote</th>
                        </tr>
                        <tr id="row-p1">
                            <td style="font-weight:bold; background:#ffe3e3; color:#b02a37;">P1</td>
                            <td id="p1-total">-</td><td id="p1-fin">-</td><td id="p1-and">-</td><td id="p1-pen">-</td><td id="p1-notif">-</td>
                            <td id="p1-alerta" style="text-align:left; padding-left:6px; font-weight:bold; font-size:11px;">-</td>
                        </tr>
                        <tr id="row-p2">
                            <td style="font-weight:bold; background:#ffeecc; color:#fd7e14;">P2</td>
                            <td id="p2-total">-</td><td id="p2-fin">-</td><td id="p2-and">-</td><td id="p2-pen">-</td><td id="p2-notif">-</td>
                            <td id="p2-alerta" style="text-align:left; padding-left:6px; font-weight:bold; font-size:11px;">-</td>
                        </tr>
                        <tr id="row-p3">
                            <td style="font-weight:bold; background:#fff9db; color:#f59f00;">P3</td>
                            <td id="p3-total">-</td><td id="p3-fin">-</td><td id="p3-and">-</td><td id="p3-pen">-</td><td id="p3-notif">-</td>
                            <td id="p3-alerta" style="text-align:left; padding-left:6px; font-weight:bold; font-size:11px;">-</td>
                        </tr>
                        <tr id="row-p4">
                            <td style="font-weight:bold; background:#e7f5ff; color:#228be6;">P4</td>
                            <td id="p4-total">-</td><td id="p4-fin">-</td><td id="p4-and">-</td><td id="p4-pen">-</td><td id="p4-notif">-</td>
                            <td id="p4-alerta" style="text-align:left; padding-left:6px; font-weight:bold; font-size:11px;">-</td>
                        </tr>
                    </table>
                </div>

                <!-- Seção da Fila de Trabalho Consolidada com Filtros Dinâmicos -->
                <div id="wrapperFilaTrabalho" style="margin-top: 12px; border-top: 1px dotted #ccc; padding-top: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: bold; font-size: 13px; color: #495057;">📋 Meus Processos</span>
                    </div>

                    <!-- Linha com os Seletores de Filtros -->
                    <div style="display: flex; gap: 6px; margin-bottom: 6px; align-items: center;">
                        <select id="filtroStatus" style="flex: 1; padding: 3px; font-size: 11px; border: 1px solid #ced4da; border-radius: 4px; background: #fff; cursor: pointer; height: 26px;">
                            <option value="ativos" selected>Status: Ativos (Pen/And)</option>
                            <option value="todos">Status: Todos</option>
                            <option value="Pendente">Status: Pendentes</option>
                            <option value="Em andamento">Status: Em andamento</option>
                            <option value="Finalizado">Status: Finalizados</option>
                        </select>
                        <select id="filtroPrio" style="flex: 1; padding: 3px; font-size: 11px; border: 1px solid #ced4da; border-radius: 4px; background: #fff; cursor: pointer; height: 26px;">
                            <option value="todas">Prioridade: Todas</option>
                            <option value="1">Prioridade: P1</option>
                            <option value="2">Prioridade: P2</option>
                            <option value="3">Prioridade: P3</option>
                            <option value="4">Prioridade: P4</option>
                            <option value="5">Prioridade: P5</option>
                            <option value="6">Prioridade: P6</option>
                            <option value="7">Prioridade: P7</option>
                            <option value="8">Prioridade: P8</option>
                            <option value="9">Prioridade: P9</option>
                            <option value="Saldo">Origem: Saldo</option>
                            <option value="INCON">Origem: Inconsistências (INCON)</option>
                            <option value="S/P">Prioridade: Sem Prio (S/P)</option>
                        </select>
                        <button id="btnFiltroNotif" data-ativo="false" style="flex: 1; padding: 3px 6px; font-size: 11px; border: 1px solid #ced4da; border-radius: 4px; background: #fff; color: #495057; font-weight: bold; cursor: pointer; height: 26px; transition: all 0.2s; white-space: nowrap;">
                            📖 Notif
                        </button>
                    </div>

                    <div id="listaFilaTrabalho" style="max-height: 200px; overflow-y: auto; border: 1px solid #ced4da; border-radius: 4px; padding: 4px; background: #f8f9fa;">
                        <div style="text-align: center; color: #6c757d; font-size: 12px; padding: 10px;">
                            Clique em "📊 Gerar Contadores" para varrer todas as páginas e montar a fila de prioridades.
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('btnFecharPainelSrv').onclick = () => painel.style.display = 'none';

        const btnMin = document.getElementById('btnMinimizarPainelSrv');
        btnMin.onclick = function() {
            const conteudo = document.getElementById('conteudoPainelServidor');
            if (conteudo.style.display === 'none') {
                conteudo.style.display = 'block';
                this.innerText = '➖ Minimizar';
                painel.style.width = '640px';
            } else {
                conteudo.style.display = 'none';
                this.innerText = '➕ Mostrar';
                painel.style.width = '200px';
            }
        };

        const btnTogglePrio = document.getElementById('btnTogglePrioridades');
        const wrapperPrio = document.getElementById('wrapperPrioridades');
        btnTogglePrio.onclick = function() {
            if (wrapperPrio.style.display === 'none') {
                wrapperPrio.style.display = 'block';
                this.innerText = '🔽 Recolher Detalhamento por Prioridades';
            } else {
                wrapperPrio.style.display = 'none';
                this.innerText = '➕ Mostrar Detalhamento por Prioridades (P1 a P4)';
            }
        };

        const elStatus = document.getElementById('filtroStatus');
        const elPrio = document.getElementById('filtroPrio');
        if (elStatus) elStatus.onchange = () => atualizarFilaTrabalhoPainel();
        if (elPrio) elPrio.onchange = () => atualizarFilaTrabalhoPainel();

        const btnNotif = document.getElementById('btnFiltroNotif');
        if (btnNotif) {
            btnNotif.onclick = () => {
                const ativo = btnNotif.getAttribute('data-ativo') === 'true';
                const novoEstado = !ativo;
                btnNotif.setAttribute('data-ativo', String(novoEstado));

                if (novoEstado) {
                    btnNotif.style.background = '#dc3545';
                    btnNotif.style.color = '#fff';
                    btnNotif.style.borderColor = '#b02a37';
                } else {
                    btnNotif.style.background = '#fff';
                    btnNotif.style.color = '#495057';
                    btnNotif.style.borderColor = '#ced4da';
                }
                atualizarFilaTrabalhoPainel();
            };
        }



        tornarElementoArrastavel(painel, document.getElementById("cabecalhoPainelServidor"));
        atualizarFilaTrabalhoPainel();
    }

    // Função auxiliar para identificar a página ativa no paginador do PrimeNG ou PrimeFaces
    function obterPaginaAtual() {
        const paginatorContainer = document.querySelector('.p-paginator, .ui-paginator');
        if (paginatorContainer) {
            const paginadorAtivo = paginatorContainer.querySelector('.p-highlight, .ui-state-active');
            if (paginadorAtivo) {
                const parsed = parseInt(paginadorAtivo.innerText.trim(), 10);
                if (!isNaN(parsed)) return parsed;
            }
        }
        return 1;
    }

    // Função para alterar a página do SIMAP de maneira assíncrona e extremamente robusta
    async function irParaPagina(numeroPagina) {
        let paginaAtual = obterPaginaAtual();
        if (paginaAtual === numeroPagina) return true;

        // 1. Tenta achar o botão direto pelo número da página, restringindo ao paginador para evitar falsos positivos
        const paginatorContainer = document.querySelector('.p-paginator, .ui-paginator');
        let botaoAlvo = null;
        if (paginatorContainer) {
            botaoAlvo = paginatorContainer.querySelector(`[aria-label="Page ${numeroPagina}"], [aria-label="Página ${numeroPagina}"], [aria-label="page ${numeroPagina}"]`);

            if (!botaoAlvo) {
                const botoesAria = Array.from(paginatorContainer.querySelectorAll('[aria-label*="Page"], [aria-label*="Página"], [aria-label*="page"]'));
                botaoAlvo = botoesAria.find(b => {
                    const label = b.getAttribute('aria-label') || "";
                    const match = label.match(/\d+/);
                    return match ? match[0] === String(numeroPagina) : false;
                });
            }

            if (!botaoAlvo) {
                const botoes = Array.from(paginatorContainer.querySelectorAll('.p-paginator-page, button.p-link, .ui-paginator-page, button'));
                botaoAlvo = botoes.find(b => b.innerText.trim() === String(numeroPagina));
            }
        }

        if (botaoAlvo) {
            botaoAlvo.click();
        } else {
            // 2. Se não achou o botão direto, faz navegação estratégica / passo a passo
            if (numeroPagina === 1) {
                const firstBtn = document.querySelector('.p-paginator-first, .ui-paginator-first, [aria-label="Primeira Página"], [aria-label="First Page"]');
                if (firstBtn && !firstBtn.disabled && firstBtn.getAttribute('aria-disabled') !== 'true') {
                    firstBtn.click();
                } else {
                    return false;
                }
            } else if (numeroPagina < paginaAtual) {
                // Tenta ir para a primeira página primeiro se a distância for maior que 1 para acelerar
                const firstBtn = document.querySelector('.p-paginator-first, .ui-paginator-first, [aria-label="Primeira Página"], [aria-label="First Page"]');
                if (firstBtn && !firstBtn.disabled && firstBtn.getAttribute('aria-disabled') !== 'true' && (paginaAtual - numeroPagina) > 1) {
                    firstBtn.click();
                } else {
                    const prevBtn = document.querySelector('.p-paginator-prev, .ui-paginator-prev, [aria-label="Página Anterior"], [aria-label="Previous Page"]');
                    if (prevBtn && !prevBtn.disabled && prevBtn.getAttribute('aria-disabled') !== 'true') {
                        prevBtn.click();
                    } else {
                        return false;
                    }
                }
            } else {
                const nextBtn = document.querySelector('.p-paginator-next, .ui-paginator-next, [aria-label="Página Seguinte"], [aria-label="Next Page"]');
                if (nextBtn && !nextBtn.disabled && nextBtn.getAttribute('aria-disabled') !== 'true') {
                    nextBtn.click();
                } else {
                    return false;
                }
            }
        }

        // Aguarda até que a página mude para a desejada (tentativas por até 4 segundos)
        for (let i = 0; i < 20; i++) {
            await esperar(200);
            if (obterPaginaAtual() === numeroPagina) {
                // Aguarda um pequeno tempo extra para renderização da tabela
                await esperar(500);
                return true;
            }
        }

        // Se a página mudou mas ainda não é a desejada, continua de forma recursiva
        const novaPagina = obterPaginaAtual();
        if (novaPagina !== paginaAtual) {
            return await irParaPagina(numeroPagina);
        }

        return false;
    }

    // Função para navegar até a página correta e focar/piscar a linha do processo na tela
    async function focarProcessoNaTabela(chaveNpu, numeroPagina) {
        const paginaAtual = obterPaginaAtual();

        if (paginaAtual !== numeroPagina) {
            const sucesso = await irParaPagina(numeroPagina);
            if (!sucesso) {
                alert(`Não foi possível navegar até a página ${numeroPagina}.`);
                return;
            }
        }

        // Garante que o CSS de foco está injetado no cabeçalho
        if (!document.getElementById('tontomFocoEstilo')) {
            const style = document.createElement('style');
            style.id = 'tontomFocoEstilo';
            style.textContent = `
                .tontom-linha-focada td {
                    animation: tontomPulseFoco 2s infinite ease-in-out !important;
                }
                @keyframes tontomPulseFoco {
                    0% { background-color: rgba(13, 110, 253, 0.05); }
                    50% { background-color: rgba(13, 110, 253, 0.16); }
                    100% { background-color: rgba(13, 110, 253, 0.05); }
                }
                @keyframes tontomBadgePulse {
                    from { transform: scale(1); box-shadow: 0 0 2px rgba(13,110,253,0.3); }
                    to { transform: scale(1.05); box-shadow: 0 0 6px rgba(13,110,253,0.7); }
                }
            `;
            document.head.appendChild(style);
        }

        // Limpa focos antigos de outras linhas
        document.querySelectorAll('.tontom-linha-focada').forEach(l => {
            l.classList.remove('tontom-linha-focada');
        });
        document.querySelectorAll('.tontom-badge-foco').forEach(b => {
            b.remove();
        });

        // CRÍTICO: Exclui o próprio painel da busca para não focar a linha da Fila de Trabalho no painel!
        const seletorLinhas = 'tr[data-cy="entityTable"], tbody tr';
        const linhas = Array.from(document.querySelectorAll(seletorLinhas))
                            .filter(linha => !linha.closest('#painelContadoresServidor'));

        let linhaAlvo = null;
        linhas.forEach(linha => {
            if (!linha.innerText) return;
            // Procura todas as ocorrências de NPU na linha e verifica qual corresponde à chave
            const matches = linha.innerText.match(/\b\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}\b/g);
            if (matches) {
                for (const match of matches) {
                    if (limparNPU(match) === chaveNpu) {
                        linhaAlvo = geometryRowRoot(linha);
                        break;
                    }
                }
            }
        });

        function geometryRowRoot(elem) {
            // Garante que pegamos o elemento TR correspondente
            return elem.tagName === 'TR' ? elem : elem.closest('tr') || elem;
        }

        if (linhaAlvo) {
            // Centraliza o processo focado na tela com scroll suave
            linhaAlvo.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Adiciona classe de foco persistente
            linhaAlvo.classList.add('tontom-linha-focada');

            // Injeta o badge visual "📍 Focado"
            const cells = Array.from(linhaAlvo.querySelectorAll('td'));
            const cellNpu = cells.find(td => /\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}/.test(td.innerText));
            if (cellNpu) {
                const badge = document.createElement('span');
                badge.className = 'tontom-badge-foco';
                badge.innerHTML = '📍 Focado';
                badge.title = 'Processo focado. Clique neste selo para remover o destaque.';
                badge.style.cssText = 'display: inline-block; padding: 2px 6px; background: #0d6efd; color: #fff; font-size: 10px; font-weight: bold; border-radius: 4px; margin-right: 8px; animation: tontomBadgePulse 1s infinite alternate; font-family: sans-serif; cursor: pointer; user-select: none; vertical-align: middle;';

                badge.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    linhaAlvo.classList.remove('tontom-linha-focada');
                    badge.remove();
                };

                cellNpu.insertBefore(badge, cellNpu.firstChild);
            }

        } else {
            alert(`Processo encontrado na página ${numeroPagina}, mas a linha correspondente na tabela não pôde ser carregada. Tente rolar a tabela manualmente.`);
        }
    }

    // Sincroniza em tempo real as alterações feitas pelo usuário na página atual, sem precisar re-varrer
    function atualizarDadosPaginaAtual() {
        if (processosVarridos.length === 0) return; // Só roda se a varredura inicial já ocorreu
        if (varreduraAtiva) return; // Durante a varredura os dados são controlados somente pelo laço de varredura

        const regexValidaNPU = /\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}/;
        const seletorLinhas = 'tr[data-cy="entityTable"], tbody tr';
        const linhas = Array.from(document.querySelectorAll(seletorLinhas))
                            .filter(linha => !linha.closest('#painelContadoresServidor') && !linha.closest('#tontomControlesServidor'));

        let houveAlteracao = false;

        linhas.forEach(linha => {
            if (!linha.innerText) return;
            const matchNPU = linha.innerText.match(regexValidaNPU);
            if (matchNPU) {
                const chaveNpu = limparNPU(matchNPU[0]);
                const processo = processosVarridos.find(p => p.chave === chaveNpu);

                if (processo) {
                    // 1. Extrai o Status do DOM
                    let statusText = "Pendente";
                    const dp = inlineDropdownText(linha);
                    if (dp) {
                        if (dp.includes("Finalizado")) statusText = "Finalizado";
                        else if (dp.includes("Em andamento")) statusText = "Em andamento";
                    }

                    // 2. Extrai a quantidade de notificações nativas (livros) do DOM
                    const livros = inlinePiBooks(linha);
                    const qtdLivros = livros.length;

                    // 3. Compara com os dados guardados
                    if (processo.status !== statusText || processo.notif !== qtdLivros) {
                        processo.status = statusText;
                        processo.notif = qtdLivros;
                        houveAlteracao = true;
                    }
                }
            }
        });

        if (houveAlteracao) {
            recalcularContadoresGlobais();
            atualizarFilaTrabalhoPainel();
        }
    }

    // Recalcula e redesenha o painel geral de contadores
    function recalcularContadoresGlobais(processando = false) {
        let totalGeral = processosVarridos.length;
        let finGeral = 0;
        let andGeral = 0;
        let notifGeral = 0;

        resetarContadoresPrioridade();

        processosVarridos.forEach(p => {
            if (p.status === "Finalizado") finGeral++;
            else if (p.status === "Em andamento") andGeral++;

            notifGeral += p.notif;

            if (p.prioridade !== "S/P") {
                const nivelPrioBase = parseInt(p.prioridade, 10);
                if (nivelPrioBase >= 1 && nivelPrioBase <= 4) {
                    contadoresPrio[nivelPrioBase].total++;
                    contadoresPrio[nivelPrioBase].notif += p.notif;
                    if (p.status === "Finalizado") contadoresPrio[nivelPrioBase].fin++;
                    else if (p.status === "Em andamento") contadoresPrio[nivelPrioBase].and++;
                }
            }
        });

        atualizarValoresPainel(totalGeral, finGeral, andGeral, notifGeral, processando);
    }

    // Atualiza a visualização da fila de trabalho com botões de ação corretos e filtros dinâmicos
    function atualizarFilaTrabalhoPainel(mensagemStatus) {
        const container = document.getElementById("listaFilaTrabalho");
        if (!container) return;

        if (mensagemStatus) {
            container.innerHTML = `
                <div style="text-align: center; color: #0d6efd; font-size: 12px; padding: 10px; font-weight: bold;">
                    ⏳ ${mensagemStatus}
                </div>`;
            return;
        }

        if (processosVarridos.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #6c757d; font-size: 12px; padding: 10px;">
                    Clique em "📊 Gerar Contadores" para varrer todas as páginas e montar a fila de prioridades.
                </div>`;
            return;
        }

        const elStatus = document.getElementById("filtroStatus");
        const elPrio = document.getElementById("filtroPrio");
        const btnNotif = document.getElementById("btnFiltroNotif");

        const statusFiltro = elStatus ? elStatus.value : "ativos";
        const prioFiltro = elPrio ? elPrio.value : "todas";
        const apenasNotificados = btnNotif ? btnNotif.getAttribute('data-ativo') === 'true' : false;

        let ordenados = [...processosVarridos].sort((a, b) => a.prioValor - b.prioValor);

        // 1. Aplica o filtro de Status
        if (statusFiltro === "ativos") {
            ordenados = ordenados.filter(p => p.status !== "Finalizado");
        } else if (statusFiltro !== "todos") {
            ordenados = ordenados.filter(p => p.status === statusFiltro);
        }

        // 2. Aplica o filtro de Prioridade (P1 a P9) ou Origem (Saldo / INCON)
        if (prioFiltro !== "todas") {
            if (prioFiltro === "S/P") {
                ordenados = ordenados.filter(p => p.prioridade === "S/P");
            } else if (prioFiltro === "Saldo") {
                ordenados = ordenados.filter(p => p.tagEspecial && p.tagEspecial.startsWith("Saldo"));
            } else if (prioFiltro === "INCON") {
                ordenados = ordenados.filter(p => p.tagEspecial && p.tagEspecial.startsWith("INCON"));
            } else {
                ordenados = ordenados.filter(p => {
                    const pBase = parseInt(p.prioridade, 10);
                    return String(pBase) === prioFiltro;
                });
            }
        }

        // 3. Aplica o filtro de Apenas Notificados
        if (apenasNotificados) {
            ordenados = ordenados.filter(p => p.notif > 0);
        }

        if (ordenados.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #6c757d; font-size: 12px; padding: 10px;">
                    Nenhum processo correspondente aos filtros ativos.
                </div>`;
            return;
        }

        let html = `
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:11px; font-family:sans-serif;">
                <thead>
                    <tr style="background:#e9ecef; font-weight:bold; border-bottom:2px solid #dee2e6; position: sticky; top: 0; z-index: 10;">
                        <th style="padding:4px; width:40px; text-align:center;">Prio</th>
                        <th style="padding:4px;">Processo (NPU)</th>
                        <th style="padding:4px; width:80px; text-align:center;">Status</th>
                        <th style="padding:4px; width:40px; text-align:center;">Notif</th>
                    </tr>
                </thead>
                <tbody>
        `;

        ordenados.forEach(p => {
            let corPrio = "#64748b";
            if (p.prioValor >= 1 && p.prioValor < 2) corPrio = "#ef4444";
            else if (p.prioValor >= 2 && p.prioValor < 3) corPrio = "#f97316";
            else if (p.prioValor >= 3 && p.prioValor < 4) corPrio = "#eab308; color:#000;";
            else if (p.prioValor >= 4 && p.prioValor < 5) corPrio = "#3b82f6";
            else if (p.prioValor >= 5 && p.prioValor < 6) corPrio = "#a855f7";
            else if (p.prioValor >= 6 && p.prioValor < 7) corPrio = "#10b981";
            else if (p.prioValor >= 7 && p.prioValor < 8) corPrio = "#6366f1";
            else if (p.prioValor >= 8 && p.prioValor < 9) corPrio = "#ec4899";
            else if (p.prioValor >= 9 && p.prioValor < 10) corPrio = "#64748b";

            const tagEstilo = `display:inline-block; padding:1px 4px; font-weight:bold; font-size:9px; color:#fff; border-radius:3px; background:${corPrio};`;

            let tagEspHtml = "";
            if (p.tagEspecial) {
                const corEsp = p.tagEspecial.startsWith("Saldo") ? "#059669" : "#d97706";
                tagEspHtml = `<span style="display:inline-block; margin-left:4px; padding:1px 4px; font-weight:bold; font-size:9px; color:#fff; border-radius:3px; background:${corEsp};">${p.tagEspecial}</span>`;
            }

            if (p.scga) {
                tagEspHtml += `<span style="display:inline-block; margin-left:4px; padding:1px 4px; font-weight:bold; font-size:9px; color:#000; border-radius:3px; background:#facc15;">SCGA</span>`;
            }

            // O NPU vira um link interno limpo
            const linkDisplay = `<a href="#" class="npu-link-click" data-chave="${p.chave}" data-pagina="${p.pagina}" title="Ir para este processo na Tabela do SIMAP (Pág ${p.pagina})" style="color:#0d6efd; font-weight:bold; text-decoration:underline; cursor:pointer;">${p.npu}</a>`;

            // Botão de copiar o número limpo ao lado do processo
            const botaoCopiar = `<button class="btn-copiar-npu" data-npu="${p.npu}" title="Copiar número do processo para colar no PJe" style="margin-left: 6px; padding: 1px 4px; font-size: 10px; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 3px; font-family: sans-serif; transition: background 0.15s;">📋</button>`;

            let statusCor = "#6c757d";
            if (p.status === "Finalizado") statusCor = "#157347";
            else if (p.status === "Em andamento") statusCor = "#0d6efd";

            html += `
                <tr style="border-bottom:1px solid #dee2e6; background:#fff; height:24px;">
                    <td style="padding:4px; text-align:center;"><span style="${tagEstilo} white-space:nowrap;">P${p.prioridade}${p.descPrio ? '-' + p.descPrio : ''}</span></td>
                    <td style="padding:4px; word-break:break-all; display: flex; align-items: center; flex-wrap: wrap;">${linkDisplay}${tagEspHtml} ${botaoCopiar}</td>
                    <td style="padding:4px; text-align:center; color:${statusCor}; font-weight:bold;">${p.status}</td>
                    <td style="padding:4px; text-align:center;">${p.notif > 0 ? `<span style="color:#dc3545; font-weight:bold;">⚠️ ${p.notif}</span>` : '-'}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;
        container.innerHTML = html;

        // Ouvinte de clique para copiar NPU individual
        container.querySelectorAll('.btn-copiar-npu').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const npuText = btn.getAttribute('data-npu');
                navigator.clipboard.writeText(npuText).then(() => {
                    btn.innerText = "✅";
                    btn.style.background = "#d4edda";
                    setTimeout(() => {
                        btn.innerText = "📋";
                        btn.style.background = "#fff";
                    }, 1200);
                });
            };
        });

        // Ouvinte de clique para focar o processo na tabela do SIMAP
        container.querySelectorAll('.npu-link-click').forEach(link => {
            link.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const chave = link.getAttribute('data-chave');
                const pagina = parseInt(link.getAttribute('data-pagina'), 10);
                focarProcessoNaTabela(chave, pagina);
            };
        });
    }

    function alternarPausaServidor() {
        if (!varreduraAtiva) return;
        varreduraPausada = !varreduraPausada;
        atualizarBotoesUI();
    }

    function atualizarBotoesUI() {
        const btnCarregar = document.getElementById("btnGerarContadores");
        const btnPause = document.getElementById("btnServidorPause");
        if (!btnCarregar || !btnPause) return;

        if (varreduraAtiva) {
            btnCarregar.innerText = varreduraPausada ? "▶️ Continuar" : "⏳ Processando...";
            btnCarregar.style.background = "#6c757d";
            btnPause.disabled = false;
            btnPause.innerText = varreduraPausada ? "▶️" : "⏸️";
            btnPause.style.background = varreduraPausada ? "#ffc107" : "#6c757d";
        } else {
            btnCarregar.innerText = "📊 Gerar Contadores";
            btnCarregar.style.background = "#0d6efd";
            btnPause.disabled = true;
            btnPause.innerText = "⏸️";
            btnPause.style.background = "#e9ecef";
        }
    }

    function resetarContadoresPrioridade() {
        for (let i = 1; i <= 4; i++) {
            contadoresPrio[i] = { total: 0, fin: 0, and: 0, pen: 0, notif: 0 };
        }
    }

    // Retorna apenas as linhas da tabela real do SIMAP (ignora painel, controles e menu do próprio script)
    function obterLinhasTabelaReal() {
        return Array.from(document.querySelectorAll('tr[data-cy="entityTable"], tbody tr'))
            .filter(linha => !linha.closest('#painelContadoresServidor') &&
                             !linha.closest('#tontomControlesServidor') &&
                             !linha.closest('#containerMenuTontom'));
    }

    // Assinatura da página exibida (lista de NPUs das linhas). Usada para saber quando a paginação realmente trocou de página
    function assinaturaPaginaAtual() {
        const regex = /\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}/;
        const chaves = [];
        obterLinhasTabelaReal().forEach(linha => {
            const m = childText(linha).match(regex);
            if (m) chaves.push(limparNPU(m[0]));
        });
        return chaves.join('|');
    }

    function botaoPaginadorDisponivel(btn) {
        return !!btn && !btn.disabled &&
               btn.getAttribute('aria-disabled') !== 'true' &&
               !btn.classList.contains('p-disabled') &&
               !btn.classList.contains('ui-state-disabled');
    }

    // Espera a tabela trocar de página (assinatura diferente da anterior) e estabilizar (linhas/dropdowns renderizados).
    // Retorna true se a página mudou, false se estourou o tempo sem mudança.
    async function aguardarTrocaDePagina(assinaturaAnterior, timeoutMs = 10000) {
        const inicio = Date.now();
        let mudou = false;
        while (Date.now() - inicio < timeoutMs) {
            if (abortarVarredura) return false;
            await esperar(200);
            const atual = assinaturaPaginaAtual();
            if (atual !== '' && atual !== assinaturaAnterior) { mudou = true; break; }
        }
        if (!mudou) return false;

        // Aguarda estabilização: assinatura igual em duas leituras consecutivas
        let ultima = assinaturaPaginaAtual();
        for (let i = 0; i < 15; i++) {
            await esperar(300);
            const agora = assinaturaPaginaAtual();
            if (agora === ultima) break;
            ultima = agora;
        }
        await esperar(300); // tempo extra para os dropdowns de status/ícones de notificação renderizarem
        return true;
    }

    async function rodarVarreduraServidor() {
        if (varreduraAtiva) return;
        varreduraAtiva = true;
        varreduraPausada = false;
        abortarVarredura = false;
        atualizarBotoesUI();

        try {
            await executarVarreduraServidor();
        } catch (err) {
            console.error("😸 [Tontom] Erro durante a varredura:", err);
        } finally {
            // Garante que o botão nunca fique travado em "Processando..." após um erro
            varreduraAtiva = false;
            atualizarBotoesUI();
            // Fonte única da verdade: recalcula tudo a partir de processosVarridos (evita somar sobre valores antigos)
            recalcularContadoresGlobais();
            atualizarFilaTrabalhoPainel();
        }
    }

    async function executarVarreduraServidor() {
        criarPainelServidor();
        const painel = document.getElementById("painelContadoresServidor");
        painel.style.display = "block";
        renderizarEstruturaPainel();

        document.getElementById("srv-total").innerText = "⏳";
        document.getElementById("srv-fin").innerText = "⏳";
        document.getElementById("srv-and").innerText = "⏳";
        document.getElementById("srv-pen").innerText = "⏳";
        document.getElementById("srv-pct").innerText = "⏳";
        document.getElementById("srv-notif").innerText = "⏳";

        for(let i=1; i<=4; i++) {
            document.getElementById(`p${i}-total`).innerText = "⏳";
            document.getElementById(`p${i}-fin`).innerText = "⏳";
            document.getElementById(`p${i}-and`).innerText = "⏳";
            document.getElementById(`p${i}-pen`).innerText = "⏳";
            document.getElementById(`p${i}-notif`).innerText = "⏳";
            document.getElementById(`p${i}-alerta`).innerText = "-";
        }

        // RESET TOTAL: cada clique em "Gerar Contadores" recalcula tudo do zero
        resetarContadoresPrioridade();
        processosVarridos = [];
        diagnosticoVarredura = { paginas: [], repetidos: [], passadas: [], esperado: null, ordenacao: '' };
        atualizarFilaTrabalhoPainel("Iniciando a varredura...");

        const esperadoInicial = lerTotalEsperadoPaginador();
        const totalEsperado = esperadoInicial ? esperadoInicial.total : null;
        diagnosticoVarredura.esperado = totalEsperado;

        // O SIMAP pagina no servidor com ordem instável: o mesmo processo pode aparecer em duas páginas e outro
        // não aparecer em nenhuma. Por isso (1) tentamos ordenar por NPU (chave única) e (2) repetimos a varredura
        // juntando os resultados (sem duplicar) até cobrir o total informado pelo paginador.
        atualizarFilaTrabalhoPainel("Verificando ordenação da tabela...");
        diagnosticoVarredura.ordenacao = await tentarOrdenarPorNPU();
        await irParaPrimeiraPagina();

        const processosMapeados = new Map(); // chave NPU -> entrada em processosVarridos
        const MAX_PASSADAS = 8;

        for (let passada = 1; passada <= MAX_PASSADAS; passada++) {
            if (abortarVarredura) break;
            const unicosAntes = processosVarridos.length;
            const repetidosAntes = contarRepetidosDiagnostico();

            await varrerTodasAsPaginas(passada, processosMapeados);

            const novos = processosVarridos.length - unicosAntes;
            const repetidosNaPassada = contarRepetidosDiagnostico() - repetidosAntes;
            diagnosticoVarredura.passadas.push({ passada: passada, novos: novos, totalUnicos: processosVarridos.length, repetidos: repetidosNaPassada });

            if (totalEsperado !== null && processosVarridos.length >= totalEsperado) break; // já cobriu tudo
            if (repetidosNaPassada === 0) break;     // ordem estável: uma passada basta
            if (passada > 1 && novos === 0) break;   // nada novo: o restante são repetições reais do SIMAP

            await irParaPrimeiraPagina();
        }

        // O fechamento (liberar botão, recalcular contadores a partir de processosVarridos e redesenhar a fila)
        // é feito no finally de rodarVarreduraServidor.
        exibirDiagnosticoVarredura();
    }

    function contarRepetidosDiagnostico() {
        return diagnosticoVarredura.paginas.reduce((s, p) => s + p.repetidos, 0);
    }

    async function irParaPrimeiraPagina() {
        const firstBtn = document.querySelector('.p-paginator-first, .ui-paginator-first, [aria-label="Primeira Página"], [aria-label="First Page"]');
        if (botaoPaginadorDisponivel(firstBtn)) {
            const assinaturaAntes = assinaturaPaginaAtual();
            firstBtn.click();
            // Espera a tabela realmente voltar para a página 1 (em vez de um tempo fixo que podia varrer dados velhos)
            await aguardarTrocaDePagina(assinaturaAntes);
        }
    }

    // Tenta ordenar a tabela pela coluna do NPU/Processo (valor único), para a paginação ficar estável
    async function tentarOrdenarPorNPU() {
        const ths = Array.from(document.querySelectorAll('th'))
            .filter(th => !th.closest('#painelContadoresServidor') && !th.closest('#tontomControlesServidor') && !th.closest('#containerMenuTontom'));
        const th = ths.find(t => /processo|npu/i.test(t.innerText || ''));
        if (!th) return 'coluna NPU/Processo não encontrada';

        const sortavel = th.matches('[psortablecolumn], .p-sortable-column, [aria-sort]') ||
                         !!th.querySelector('p-sorticon, .p-sortable-column-icon, [class*="sort"]');
        if (!sortavel) return 'coluna NPU/Processo não é ordenável';

        const estado = th.getAttribute('aria-sort') || 'none';
        if (estado === 'ascending' || estado === 'descending') return 'já ordenada por NPU (' + estado + ')';

        const assinaturaAntes = assinaturaPaginaAtual();
        th.click();
        await aguardarTrocaDePagina(assinaturaAntes, 6000);
        return 'ordenada por clique no cabeçalho (aria-sort=' + (th.getAttribute('aria-sort') || '?') + ')';
    }

    // Percorre todas as páginas uma vez, acrescentando em processosVarridos apenas NPUs ainda não vistos
    async function varrerTodasAsPaginas(passada, processosMapeados) {
        const regexValidaNPU = /\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}/;
        let paginaAtual = 1;

        while (true) {
            if (abortarVarredura) break;
            while (varreduraPausada) {
                await esperar(500);
                if (abortarVarredura) break;
            }
            if (abortarVarredura) break;

            atualizarFilaTrabalhoPainel(`Passada ${passada}: varrendo processos da Página ${paginaAtual}...`);

            // Ignora linhas do painel/menu do próprio script (evita contar a Fila de Trabalho como se fosse a tabela do SIMAP)
            const linhas = obterLinhasTabelaReal();
            const diagPagina = { passada: passada, pagina: paginaAtual, linhas: linhas.length, comNpu: 0, novos: 0, repetidos: 0, semNpu: 0, multiNpu: 0 };
            diagnosticoVarredura.paginas.push(diagPagina);

            linhas.forEach(linha => {
                const textoLinha = childText(linha);
                if (!textoLinha || textoLinha.includes("Nenhum registro encontrado")) return;

                const matchNPU = textoLinha.match(regexValidaNPU);
                if (!matchNPU) { diagPagina.semNpu++; return; }
                diagPagina.comNpu++;
                const todosNpus = textoLinha.match(new RegExp(regexValidaNPU.source, 'g')) || [];
                if (new Set(todosNpus.map(limparNPU)).size > 1) diagPagina.multiNpu++;

                const npuFormatado = matchNPU[0];
                const chaveNpu = limparNPU(npuFormatado);

                const existente = processosMapeados.get(chaveNpu);
                if (existente) {
                    diagPagina.repetidos++;
                    if (passada === 1) {
                        diagnosticoVarredura.repetidos.push({
                            npu: npuFormatado,
                            paginaOrigem: existente.pagina,
                            paginaAtual: paginaAtual,
                            linha: textoLinha.replace(/\s+/g, ' ').substring(0, 200)
                        });
                    }
                    return;
                }
                diagPagina.novos++;

                const qtdLivrosNaLinha = inlinePiBooks(linha).length;

                let statusText = "Pendente";
                const dp = inlineDropdownText(linha);
                if (dp) {
                    if (dp.includes("Finalizado")) statusText = "Finalizado";
                    else if (dp.includes("Em andamento")) statusText = "Em andamento";
                }

                const prioridadeIdentificada = BANCO_PRIORIDADES.has(chaveNpu) ? BANCO_PRIORIDADES.get(chaveNpu) : null;
                const parsedPrio = prioridadeIdentificada ? parseFloat(String(prioridadeIdentificada).replace(',', '.')) : 999;

                const entrada = {
                    npu: npuFormatado,
                    chave: chaveNpu,
                    prioridade: prioridadeIdentificada || "S/P",
                    tagEspecial: BANCO_TAGS_ESPECIAIS.get(chaveNpu) || null,
                    scga: BANCO_SCGA.has(chaveNpu),
                    descPrio: BANCO_PRIO_DESC.get(chaveNpu) || null,
                    prioValor: parsedPrio,
                    status: statusText,
                    notif: qtdLivrosNaLinha,
                    pagina: paginaAtual
                };
                processosVarridos.push(entrada);
                processosMapeados.set(chaveNpu, entrada);
            });

            // Progresso parcial: sempre calculado a partir de processosVarridos (fonte única da verdade)
            recalcularContadoresGlobais(true);

            const nextBtn = document.querySelector('.p-paginator-next, .ui-paginator-next, [aria-label="Página Seguinte"], [aria-label="Next Page"]');
            if (!botaoPaginadorDisponivel(nextBtn)) break;

            const assinaturaAntes = assinaturaPaginaAtual();
            nextBtn.click();
            // Só avança quando a tabela realmente trocou de página; evita pular páginas ou re-varrer dados antigos
            const trocou = await aguardarTrocaDePagina(assinaturaAntes);
            if (!trocou) break;
            paginaAtual++;
        }
    }

    // Lê do paginador o total de registros informado pelo SIMAP (ex.: "Mostrando 1 a 20 de 260"), se existir
    function lerTotalEsperadoPaginador() {
        const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
        const m = txt.match(/Mostrando\s+\d+\s*[-–]\s*\d+\s+de\s+(\d+)/i) || txt.match(/\bde\s+(\d+)\s+(?:resultados|registros|itens)/i);
        return m ? { total: parseInt(m[1], 10), texto: m[0] } : null;
    }

    // Diagnóstico da varredura: mostra no painel e no console (F12) o que foi lido em cada página
    function exibirDiagnosticoVarredura() {
        const d = diagnosticoVarredura;
        const esperado = lerTotalEsperadoPaginador();
        const linhasLidas = d.paginas.reduce((s, p) => s + p.comNpu, 0);
        const msg = `🔎 ${d.passadas.length} passada(s) | ${linhasLidas} linhas lidas | ${processosVarridos.length} únicos` +
                    (esperado ? ` | paginador informa: ${esperado.total}` : ' | paginador: total não encontrado') +
                    ` | ordenação: ${d.ordenacao || 'n/d'}`;

        console.group("😸 [Tontom] Diagnóstico da varredura");
        console.log(msg);
        if (esperado) console.log("Texto do paginador:", esperado.texto);
        console.table(d.passadas);
        console.table(d.paginas);
        if (d.repetidos.length) console.table(d.repetidos);
        console.groupEnd();
        window.tontomDiagnostico = { passadas: d.passadas, paginas: d.paginas, repetidos: d.repetidos, esperado: esperado, ordenacao: d.ordenacao };

        const painel = document.getElementById("painelContadoresServidor");
        const lista = document.getElementById("listaFilaTrabalho");
        if (!painel || !lista) return;
        let el = document.getElementById("tontomDiagScan");
        if (!el) {
            el = document.createElement("div");
            el.id = "tontomDiagScan";
            el.style.cssText = "font-size:10px; color:#6c757d; padding:2px 4px; font-family:sans-serif;";
            lista.parentElement.insertBefore(el, lista);
        }
        el.innerText = msg;
    }

    function inlinePiBooks(linha) {
        return Array.from(linha.querySelectorAll('i.pi.pi-book.text-red-500, i.pi-book.text-red-500'));
    }

    // Retorna o elemento dropdown correspondente
    function inlineDropdown(linha) {
        return linha.querySelector('p-dropdown, .p-dropdown');
    }

    function inlineDropdownText(linha) {
        const dp = inlineDropdown(linha);
        if (!dp) return null;
        return dp.getAttribute('aria-label') || dp.querySelector('.p-dropdown-label')?.getAttribute('aria-label') || dp.querySelector('.p-dropdown-label')?.innerText?.trim();
    }

    function atualizarValoresPainel(total, fin, and, notif, processando) {
        const penGeral = total - (fin + and);
        const pct = total > 0 ? ((fin / total) * 100).toFixed(1) + "%" : "0.0%";

        const elTotal = document.getElementById("srv-total");
        if (!elTotal) return;

        const prefixo = processando ? "⏳ " : "";

        elTotal.innerHTML = `${prefixo}<strong>${total}</strong>`;
        document.getElementById("srv-fin").innerHTML = `${prefixo}<strong>${fin}</strong>`;
        document.getElementById("srv-and").innerHTML = `${prefixo}<strong>${and}</strong>`;
        document.getElementById("srv-pct").innerText = pct;
        document.getElementById("srv-notif").innerHTML = `${prefixo}<strong>${notif}</strong>`;

        const elPenGeral = document.getElementById("srv-pen");
        elPenGeral.innerHTML = `${prefixo}<strong>${penGeral >= 0 ? penGeral : 0}</strong>`;
        elPenGeral.style.color = penGeral > 0 ? "#b02a37" : "#157347";
        elPenGeral.style.fontWeight = penGeral > 0 ? "bold" : "normal";

        // Indica a coluna individual de Pendentes (Processos que não sofreram alteração na sessão)
        for (let i = 1; i <= 4; i++) {
            contadoresPrio[i].pen = contadoresPrio[i].total - (contadoresPrio[i].fin + contadoresPrio[i].and);
        }

        // Nova Lógica de Alertas Inteligentes com Cascata Flexível (Refinada pela Gestora)
        for (let i = 1; i <= 4; i++) {
            const pData = contadoresPrio[i];
            document.getElementById(`p${i}-total`).innerText = pData.total;
            document.getElementById(`p${i}-fin`).innerText = pData.fin;
            document.getElementById(`p${i}-and`).innerText = pData.and;

            const elPrioPen = document.getElementById(`p${i}-pen`);
            elPrioPen.innerText = pData.pen >= 0 ? pData.pen : 0;
            elPrioPen.style.color = pData.pen > 0 ? "#b02a37" : "#157347";
            elPrioPen.style.fontWeight = pData.pen > 0 ? "bold" : "normal";

            document.getElementById(`p${i}-notif`).innerText = pData.notif;

            const elAlerta = document.getElementById(`p${i}-alerta`);

            if (pData.total === 0) {
                elAlerta.innerText = "-";
                elAlerta.style.color = "#777";
                continue;
            }

            // 1. CHECAGEM DE CASCATA FLEXÍVEL: Alguma prioridade acima está com pendência BRUTA (pen > 0)?
            let bloqueadoPorPrioAcima = false;
            let maiorBloqueador = null;

            for (let j = 1; j < i; j++) {
                if (contadoresPrio[j].total > 0 && contadoresPrio[j].pen > 0) {
                    bloqueadoPorPrioAcima = true;
                    maiorBloqueador = j;
                    break; // O primeiro lote intocado acima trava a cascata
                }
            }

            // 2. APLICAÇÃO DOS ALERTAS DA SUA NOVA REGRA:
            if (bloqueadoPorPrioAcima) {
                // Bloqueado apenas se houver pendente bruto acima
                elAlerta.innerText = `⚠️ Atenção! Cumpra P${maiorBloqueador} primeiro.`;
                elAlerta.style.color = "#dc3545";
            } else {
                // Lote acima está limpo OU apenas em andamento (com pendência de prazo/sistema), liberando a linha atual!
                if (pData.fin === pData.total) {
                    elAlerta.innerText = (i === 1) ? "✅100% Finalizado" : "✅ 100% Finalizado";
                    elAlerta.style.color = "#157347";
                } else if (pData.pen > 0) {
                    // Tem pendências brutas no lote atual
                    elAlerta.innerText = (i === 1) ? "🎯 Há pendências na fila de P1" : "▶️ Liberado para cumprir";
                    elAlerta.style.color = (i === 1) ? "#d63384" : "#0d6efd";
                } else {
                    // pen === 0 e and > 0: Só restam processos em andamento aguardando algo externo
                    elAlerta.innerText = `⏳ Finalizar andamentos de P${i}`;
                    elAlerta.style.color = "#fd7e14";
                }
            }
        }
    }

    // Torna o elemento arrastável na tela
    function tornarElementoArrastavel(elemento, gatilho) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        // Aplica posição salva anteriormente se existir
        const salvoTop = localStorage.getItem(elemento.id + '_top');
        const salvoLeft = localStorage.getItem(elemento.id + '_left');
        if (salvoTop && salvoLeft) {
            elemento.style.top = salvoTop;
            elemento.style.left = salvoLeft;
        }

        if (gatilho) {
            gatilho.onmousedown = dragMouseDown;
        }

        // Permite arrastar por qualquer área neutra (vazia) do próprio painel
        elemento.onmousedown = function(e) {
            // Ignora cliques em elementos interativos
            const tag = e.target.tagName;
            const classes = String(e.target.className || "");
            const ids = String(e.target.id || "");

            if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'A' || tag === 'TH' || tag === 'TD' ||
                ids.includes('cabecalho') || e.target.closest('#cabecalhoPainelServidor') ||
                classes.includes('btn') || classes.includes('p-dropdown') || classes.includes('npu-link-click')) {
                return;
            }
            dragMouseDown(e);
        };

        function dragMouseDown(e) {
            e = e || window.event;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            let novoTop = elemento.offsetTop - pos2;
            let novoLeft = elemento.offsetLeft - pos1;

            const h = elemento.offsetHeight || 350;
            const w = elemento.offsetWidth || 640;

            // Permite sumir quase tudo, deixando pelo menos 15px visíveis nas quatro bordas
            const minTop = -(h - 15);
            const maxTop = window.innerHeight - 15;
            const minLeft = -(w - 15);
            const maxLeft = window.innerWidth - 15;

            if (novoTop < minTop) novoTop = minTop;
            if (novoTop > maxTop) novoTop = maxTop;
            if (novoLeft < minLeft) novoLeft = minLeft;
            if (novoLeft > maxLeft) novoLeft = maxLeft;

            elemento.style.top = novoTop + "px";
            elemento.style.left = novoLeft + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;

            // Salva a posição final no localStorage
            localStorage.setItem(elemento.id + '_top', elemento.style.top);
            localStorage.setItem(elemento.id + '_left', elemento.style.left);
        }
    }

    // Inicialização
    carregarDadosPlanilha();
    carregarObservacoesPlanilha();

    // Atualiza observações periodicamente a cada 5 minutos
    setInterval(() => {
        carregarObservacoesPlanilha();
    }, 5 * 60 * 1000);

    // Tenta injetar os controles e painel do servidor de forma recorrente até que a página carregue a tabela
    const intervalInicial = setInterval(() => {
        if (criarControlesServidor()) {
            criarPainelServidor();
            clearInterval(intervalInicial);
        }
    }, 500);

    // Observador DOM para aplicar tags de prioridade, menu e monitorar atualizações em tempo real
    const observer = new MutationObserver((mutations) => {
        // Ignora atualizações se a mutação ocorreu apenas dentro do nosso próprio painel ou menu flutuante
        const apenasNossoPainel = mutations.every(m =>
            m.target.closest('#painelContadoresServidor') ||
            m.target.closest('#containerMenuTontom') ||
            m.target.closest('#tontomControlesServidor')
        );
        if (apenasNossoPainel) return;

        criarControlesServidor();
        aplicarTagsNaTela();
        injetarMenuFlutuante();
        atualizarDadosPaginaAtual();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // ==========================================
    // PARTE 4: AUTOMAÇÃO DE BUSCA DE NPU POR HASH
    // ==========================================
    function executarBuscaAutomaticaNPU() {
        const hash = window.location.hash;
        if (!hash || !hash.startsWith("#npu=")) return;
        const npu = hash.replace("#npu=", "").trim();
        if (!npu) return;

        console.log("😸 [Tontom] Automatizando busca de NPU:", npu);

        let tentativas = 0;
        const maxTentativas = 30; // 6 segundos no máximo

        // Limpa flag de click anterior
        window.tontomFiltroClicado = false;

        const buscarInterval = setInterval(() => {
            tentativas++;
            if (tentativas > maxTentativas) {
                clearInterval(buscarInterval);
                console.warn("😸 [Tontom] Tempo limite de busca esgotado.");
                return;
            }

            // 1. Procura o campo de entrada do NPU
            let inputNpu = null;
            const inputs = Array.from(document.querySelectorAll('input'));
            for (const input of inputs) {
                const id = String(input.id || "").toLowerCase();
                const name = String(input.name || "").toLowerCase();
                const placeholder = String(input.placeholder || "").toLowerCase();

                if (id.includes("npu") || id.includes("processo") ||
                    name.includes("npu") || name.includes("processo") ||
                    placeholder.includes("npu") || placeholder.includes("processo")) {
                    inputNpu = input;
                    break;
                }
            }

            // Método B: Se não achou por atributos diretos, busca por label contendo "NPU"
            if (!inputNpu) {
                const labels = Array.from(document.querySelectorAll('label, mat-label, span, mat-placeholder'));
                const labelNpu = labels.find(el => {
                    const text = String(el.innerText || el.textContent || "").trim().toUpperCase();
                    return text === "NPU" || text === "NPU:" || text === "PROCESSO" || text === "PROCESSO:";
                });

                if (labelNpu) {
                    const forAttr = labelNpu.getAttribute('for');
                    if (forAttr) {
                        inputNpu = document.getElementById(forAttr);
                    }
                    if (!inputNpu) {
                        let container = labelNpu.parentElement;
                        for (let depth = 0; depth < 4; depth++) {
                            if (!container || container.tagName === 'BODY') break;
                            const found = container.querySelector('input');
                            if (found) {
                                inputNpu = found;
                                break;
                            }
                            container = container.parentElement;
                        }
                    }
                }
            }

            // 2. Se o input não for encontrado, tenta expandir a seção de Filtros (APENAS UMA VEZ)
            if (!inputNpu) {
                if (!window.tontomFiltroClicado) {
                    const elements = Array.from(document.querySelectorAll('button, a, div, span, [role="button"]'));
                    const btnFiltro = elements.find(el => {
                        const text = String(el.innerText || el.textContent || "").trim().toLowerCase();
                        return text.includes("filtros");
                    });

                    if (btnFiltro) {
                        console.log("😸 [Tontom] Menu de filtros fechado. Clicando para expandir...");
                        window.tontomFiltroClicado = true;

                        // Encontra o ancestral clicável mais próximo (button ou a)
                        let clickable = btnFiltro;
                        while (clickable && clickable.tagName !== 'BODY') {
                            const tag = clickable.tagName;
                            const role = clickable.getAttribute('role');
                            const cls = String(clickable.className || "");
                            if (tag === 'BUTTON' || tag === 'A' || role === 'button' || cls.includes('btn') || cls.includes('button')) {
                                break;
                            }
                            clickable = clickable.parentElement;
                        }

                        if (clickable) {
                            clickable.click();
                        } else {
                            btnFiltro.click();
                        }
                    }
                }
            } else {
                // Input encontrado! Para o loop, preenche e busca.
                clearInterval(buscarInterval);

                // Preenche o NPU e dispara eventos para simular digitação real (necessário para Angular/React binding)
                inputNpu.focus();
                inputNpu.value = npu;

                const keystrokeEvents = ['focus', 'keydown', 'keypress', 'input', 'keyup', 'change', 'blur'];
                keystrokeEvents.forEach(evtType => {
                    inputNpu.dispatchEvent(new Event(evtType, { bubbles: true }));
                });

                console.log("😸 [Tontom] Input do NPU preenchido com eventos de binding.");

                // Clica no botão de filtrar/pesquisar
                setTimeout(() => {
                    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
                    let btnBuscar = null;
                    for (const btn of buttons) {
                        const text = String(btn.innerText || btn.value || "").trim().toLowerCase();
                        if (text.includes("filtrar") || text.includes("buscar") || text.includes("pesquisar") || text === "consultar") {
                            btnBuscar = btn;
                            break;
                        }
                    }

                    if (btnBuscar) {
                        console.log("😸 [Tontom] Clicando no botão de busca.");
                        btnBuscar.click();
                    } else {
                        const form = inputNpu.closest('form');
                        if (form) {
                            console.log("😸 [Tontom] Submetendo formulário.");
                            form.submit();
                        }
                    }
                }, 300);
            }
        }, 300);
    }

    if (window.location.hash.startsWith("#npu=")) {
        if (document.readyState === "complete" || document.readyState === "interactive") {
            setTimeout(executarBuscaAutomaticaNPU, 500);
        } else {
            window.addEventListener('load', () => setTimeout(executarBuscaAutomaticaNPU, 500));
        }
    }
    window.addEventListener('hashchange', executarBuscaAutomaticaNPU);

})();
