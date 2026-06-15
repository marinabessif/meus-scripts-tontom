// ==UserScript==
// @name         Tontom-Simap (Servidor)
// @namespace    simap-tjpe
// @version      1.1
// @description  Menu de observações, Prioridades, painel móvel com lógica de fluxo refinada.
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

    const URL_PLANILHA = "https://docs.google.com/spreadsheets/d/1v4cbLicC3ilOx-cS7PP9pV82y4H6jcS_QsNn32Jcz3s/edit?gid=0#gid=0";

    GM_addStyle(`
        .tag-prioridade {
            display: inline-block;
            padding: 2px 6px;
            margin-left: 6px;
            font-weight: bold;
            font-size: 11px;
            color: #fff !important;
            border-radius: 4px;
            text-transform: uppercase;
            box-shadow: 1px 1px 3px rgba(0,0,0,0.15);
            vertical-align: middle;
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
    `);

    const BANCO_PRIORIDADES = new Map();

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


    // ==========================================
    // PARTE 3: PAINEL E VARREDURA DO SERVIDOR
    // ==========================================

    function esperar(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function criarControlesServidor() {
        if (document.getElementById("tontomControlesServidor")) return;

        const ths = Array.from(document.querySelectorAll('th')).map(th => th.innerText.toUpperCase());
        const eTelaValida = ths.some(t => t.includes("PROCESSO") || t.includes("STATUS") || t.includes("NPU"));
        if (!eTelaValida) return;

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
                        <th style="width: 110px; color: #dc3545;">⚠️ Notificação</th>
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
                            <th style="width: 45px; color: #dc3545;"> Notif</th>
                            <th style="width: 300px; color: #d63384; text-align: left; padding-left: 6px;">Alerta </th>
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

        tornarElementoArrastavel(painel, document.getElementById("cabecalhoPainelServidor"));
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

    async function rodarVarreduraServidor() {
        if (varreduraAtiva) return;
        varreduraAtiva = true;
        varreduraPausada = false;
        abortarVarredura = false;
        atualizarBotoesUI();

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

        resetarContadoresPrioridade();

        const firstBtn = document.querySelector('[aria-label="Primeira Página"]');
        if (firstBtn && !firstBtn.disabled && firstBtn.getAttribute('aria-disabled') !== 'true') {
            firstBtn.click();
            await esperar(1800);
        }

        let totalGeral = 0;
        let finGeral = 0;
        let andGeral = 0;
        let notifGeral = 0;
        const processosMapeados = new Set();
        const regexValidaNPU = /\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}/;

        while (true) {
            if (abortarVarredura) break;
            while (varreduraPausada) {
                await esperar(500);
                if (abortarVarredura) break;
            }
            if (abortarVarredura) break;

            const linhas = document.querySelectorAll('tr[data-cy="entityTable"], tbody tr');

            linhas.forEach(linha => {
                const textoLinha = linha.innerText.trim();
                if (!textoLinha || textoLinha.includes("Nenhum registro encontrado")) return;
                if (!regexValidaNPU.test(textoLinha)) return;

                if (processosMapeados.has(textoLinha)) return;
                processosMapeados.add(textoLinha);

                totalGeral++;

                const livros = linha.querySelectorAll('i.pi.pi-book.text-red-500, i.pi-book.text-red-500');
                const qtdLivrosNaLinha = livros.length;
                notifGeral += qtdLivrosNaLinha;

                let isFin = false;
                let isAnd = false;
                const dp = linha.querySelector('p-dropdown, .p-dropdown');
                if (dp) {
                    const label = dp.getAttribute('aria-label') || dp.querySelector('.p-dropdown-label')?.getAttribute('aria-label') || dp.querySelector('.p-dropdown-label')?.innerText?.trim();
                    if (label) {
                        if (label.includes("Finalizado")) { finGeral++; isFin = true; }
                        else if (label.includes("Em andamento")) { andGeral++; isAnd = true; }
                    }
                }

                const matchNPU = textoLinha.match(regexValidaNPU);
                if (matchNPU) {
                    const chaveNpu = limparNPU(matchNPU[0]);
                    if (BANCO_PRIORIDADES.has(chaveNpu)) {
                        const nivelPrio = BANCO_PRIORIDADES.get(chaveNpu);
                        if (nivelPrio >= 1 && nivelPrio <= 4) {
                            contadoresPrio[nivelPrio].total++;
                            contadoresPrio[nivelPrio].notif += qtdLivrosNaLinha;
                            if (isFin) contadoresPrio[nivelPrio].fin++;
                            else if (isAnd) contadoresPrio[nivelPrio].and++;
                        }
                    }
                }
            });

            atualizarValoresPainel(totalGeral, finGeral, andGeral, notifGeral, true);

            const nextBtn = document.querySelector('[aria-label="Página Seguinte"]');
            if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') break;

            nextBtn.click();
            await esperar(1800);
        }

        varreduraAtiva = false;
        atualizarBotoesUI();
        atualizarValoresPainel(totalGeral, finGeral, andGeral, notifGeral, false);
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

        // Calcula a coluna individual de Pendentes (Processos que não sofreram alteração na sessão)
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
                    elAlerta.innerText = (i === 1) ? "✅ Lote 100% Concluído" : "✅ Concluído";
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

    function tornarElementoArrastavel(elemento, gatilho) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        if (gatilho) {
            gatilho.onmousedown = dragMouseDown;
        } else {
            elemento.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            e = e || window.event;
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
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
            elemento.style.top = (elemento.offsetTop - pos2) + "px";
            elemento.style.left = (elemento.offsetLeft - pos1) + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }


    // ==========================================
    // PARTE 4: INICIALIZAÇÃO GERAL
    // ==========================================

    carregarDadosPlanilha();

    const observer = new MutationObserver(() => {
        aplicarTagsNaTela();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        aplicarTagsNaTela();
        injetarMenuFlutuante();
        criarControlesServidor();
        criarPainelServidor();
    }, 1200);

})();
