// ==UserScript==
// @name          Tontom-Simap - Gestores (Leve)
// @namespace     simap-tjpe
// @version      1.8.3
// @description   Extensão leve para gestores: injeta tags de prioridade (P1-P9) nos NPUs e exibe o menu flutuante de observações padronizadas na tela de cumprimento de processos.
// @match         https://simap.svc.tjpe.jus.br/*
// @match         https://*.tjpe.jus.br/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      docs.google.com
// @run-at        document-end
// @downloadURL https://update.greasyfork.org/scripts/580997/Tontom-Simap%20-%20Gestores.user.js
// @updateURL https://update.greasyfork.org/scripts/580997/Tontom-Simap%20-%20Gestores.meta.js
// ==/UserScript==
(function () {
    'use strict';
    const URL_PLANILHA = "https://docs.google.com/spreadsheets/d/1RFS3XkGQ7Ga1NqCMXJmqYGcR-JBCXtYB7r51quVb0yE/edit?gid=1744875210";
    console.log("😸 [Tontom] Iniciando extensão leve v1.5.2...");
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
    // Cria um pequeno indicador visual de que a extensão está carregada
    function mostrarAvisoCarregamento() {
        const div = document.createElement("div");
        div.style.cssText = "position: fixed; bottom: 15px; right: 15px; background: #6366f1; color: #fff; padding: 8px 12px; border-radius: 6px; font-family: sans-serif; font-size: 12px; font-weight: bold; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: opacity 0.5s;";
        div.textContent = "😸 Tontom Gestores Ativo";
        document.body.appendChild(div);
        setTimeout(() => {
            div.style.opacity = "0";
            setTimeout(() => div.remove(), 500);
        }, 3000);
    }
    // ==========================================
    // PARTE 1: LÓGICA DO MENU DE OBSERVAÇÕES
    // ==========================================
    const opcoesPadrao = [
        { texto: "DÚVIDA (campo aberto)", precisaExtra: true, labelExtra: "Digite a dúvida:" },
        { texto: "SUPERVISÃO (campo aberto)", precisaExtra: true, labelExtra: "Digite o motivo da supervisão:" },
        { texto: "SISCONDJ (Alvará gravado OU Vinculação de Conta)", precisaExtra: false },
        { texto: "PRAZO ABERTO FORA DO SISTEMA (Data de Retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", tipoExtra: "data" },
        { texto: "PRAZO EM CURSO NO SISTEMA", precisaExtra: false },
        { texto: "PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação - informar nº)", precisaExtra: true, labelExtra: "Informe o Nº do Tema/Ação:" },
        { texto: "PROCESSO SUSPENSO (Determinação judicial - informar data de retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", tipoExtra: "data" },
        { texto: "PROCESSO SUSPENSO (Data de Retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", tipoExtra: "data" },
        { texto: "PROCESSO SUSPENSO (Resposta de Precatória - PC 03/2021)", precisaExtra: false },
        { texto: "PROCESSO SUSPENSO (Julg. Agravo/Conflito de competência - informar nº)", precisaExtra: true, labelExtra: "Informe o Nº do processo:" },
        { texto: "ARQUIVO PROVISÓRIO (Data de retorno OU Motivo)", precisaExtra: true, tipoExtra: "dataOuMotivo", labelExtra: "Informe a Data ou Motivo:" },
        { texto: "ERRO DE FLUXO (Nº do Chamado ou Falha na Migração)", precisaExtra: true, labelExtra: "Informe o Nº do Chamado ou escreva falha na migração:" },
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
        // Função de validação de data dd/mm/aa
        function validarDataDDMMAA(valor) {
            if (!/^\d{2}\/\d{2}\/\d{2}$/.test(valor)) return false;
            const partes = valor.split('/');
            const dia = parseInt(partes[0], 10);
            const mes = parseInt(partes[1], 10);
            const anoAbrev = parseInt(partes[2], 10);
            const ano = anoAbrev <= 50 ? 2000 + anoAbrev : 1900 + anoAbrev;
            if (mes < 1 || mes > 12) return false;
            if (dia < 1) return false;
            const dataObj = new Date(ano, mes - 1, dia);
            return dataObj.getFullYear() === ano && dataObj.getMonth() === mes - 1 && dataObj.getDate() === dia;
        }

        // Função de máscara de data
        function aplicarMascaraData(input) {
            input.addEventListener('input', function(e) {
                let val = this.value.replace(/\D/g, '');
                if (val.length > 6) val = val.substring(0, 6);
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
        erroData.innerText = 'Data inválida. Use o formato dd/mm/aa.';

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
        inputDataDM.placeholder = 'dd/mm/aa';
        inputDataDM.maxLength = 8;
        inputDataDM.style.cssText = 'width: 100%; padding: 5px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; margin-bottom: 4px;';
        aplicarMascaraData(inputDataDM);

        const erroDataDM = document.createElement('span');
        erroDataDM.style.cssText = 'display: none; color: #dc3545; font-size: 11px; margin-top: 2px;';
        erroDataDM.innerText = 'Data inválida. Use o formato dd/mm/aa.';

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
        txtAreaOriginal.parentNode.insertBefore(container, txtAreaOriginal);
        // Função auxiliar para esconder todos os painéis extras
        function esconderTodosExtras() {
            divExtra.style.display = 'none';
            inputExtra.value = '';
            inputExtra.type = 'text';
            inputExtra.placeholder = '';
            inputExtra.maxLength = '';
            inputExtra.style.borderColor = '#ced4da';
            erroData.style.display = 'none';
            divDataOuMotivo.style.display = 'none';
            inputDataDM.value = '';
            inputDataDM.style.borderColor = '#ced4da';
            erroDataDM.style.display = 'none';
            inputMotivoDM.value = '';
        }

        select.addEventListener('change', function() {
            const idx = this.value;
            if (idx === '') {
                esconderTodosExtras();
                return;
            }
            const opcaoSelecionada = opcoesPadrao[idx];
            textoPrevioAoSelect = txtAreaOriginal.value.trim();

            // Lógica do campo de data + motivo (ARQUIVO PROVISÓRIO)
            if (opcaoSelecionada.tipoExtra === 'dataOuMotivo') {
                esconderTodosExtras();
                divDataOuMotivo.style.display = 'block';
                inputDataDM.value = '';
                inputMotivoDM.value = '';
                inputDataDM.focus();
                acumularTextoOficial(opcaoSelecionada.texto);
            }
            // Lógica do campo de data formatado
            else if (opcaoSelecionada.tipoExtra === 'data') {
                esconderTodosExtras();
                labelExtra.innerText = opcaoSelecionada.labelExtra;
                divExtra.style.display = 'block';
                inputExtra.type = 'text';
                inputExtra.placeholder = 'dd/mm/aa';
                inputExtra.maxLength = 8;
                inputExtra.value = '';
                aplicarMascaraData(inputExtra);
                inputExtra.focus();
                acumularTextoOficial(opcaoSelecionada.texto);
            }
            // Lógica do Campo Aberto (Normal)
            else if (opcaoSelecionada.precisaExtra) {
                esconderTodosExtras();
                labelExtra.innerText = opcaoSelecionada.labelExtra;
                divExtra.style.display = 'block';
                inputExtra.value = '';
                inputExtra.focus();
                acumularTextoOficial(opcaoSelecionada.texto);
            }
            // Opções Simples
            else {
                esconderTodosExtras();
                acumularTextoOficial(opcaoSelecionada.texto);
                select.value = '';
            }
        });

        inputExtra.addEventListener('input', function() {
            const idx = select.value;
            if (idx === '') return;
            const opcaoSelecionada = opcoesPadrao[idx];

            if (opcaoSelecionada.tipoExtra === 'data') {
                const val = this.value;
                if (val.length === 8) {
                    const valido = validarDataDDMMAA(val);
                    mostrarErroData(inputExtra, erroData, valido);
                    if (valido) {
                        substituirTextoTemporario(`${opcaoSelecionada.texto} - ${val}`);
                    } else {
                        substituirTextoTemporario(opcaoSelecionada.texto);
                    }
                } else {
                    inputExtra.style.borderColor = '#ced4da';
                    erroData.style.display = 'none';
                    substituirTextoTemporario(opcaoSelecionada.texto);
                }
            } else {
                const infoAdicional = this.value.trim();
                const textoTermo = infoAdicional ? `${opcaoSelecionada.texto} - ${infoAdicional}` : opcaoSelecionada.texto;
                substituirTextoTemporario(textoTermo);
            }
        });

        inputExtra.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const idx = select.value;
                if (idx !== '') {
                    const opc = opcoesPadrao[idx];
                    if (opc.tipoExtra === 'data' && inputExtra.value.length === 8 && !validarDataDDMMAA(inputExtra.value)) {
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
            const opcaoSelecionada = opcoesPadrao[idx];
            const dataVal = inputDataDM.value.trim();
            const motivoVal = inputMotivoDM.value.trim();

            if (dataVal.length === 8) {
                const valido = validarDataDDMMAA(dataVal);
                mostrarErroData(inputDataDM, erroDataDM, valido);
                if (!valido) {
                    substituirTextoTemporario(opcaoSelecionada.texto);
                    return;
                }
            } else {
                inputDataDM.style.borderColor = '#ced4da';
                erroDataDM.style.display = 'none';
            }

            let partes = [];
            if (dataVal.length === 8 && validarDataDDMMAA(dataVal)) {
                partes.push(dataVal);
            }
            if (motivoVal) {
                partes.push(motivoVal);
            }

            const textoTermo = partes.length > 0 ? `${opcaoSelecionada.texto} - ${partes.join(' - ')}` : opcaoSelecionada.texto;
            substituirTextoTemporario(textoTermo);
        }

        inputDataDM.addEventListener('input', atualizarTextoDataOuMotivo);
        inputMotivoDM.addEventListener('input', atualizarTextoDataOuMotivo);

        inputDataDM.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (inputDataDM.value.length === 8 && !validarDataDDMMAA(inputDataDM.value)) return;
                inputMotivoDM.focus();
            }
        });

        inputMotivoDM.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (inputDataDM.value.length === 8 && !validarDataDDMMAA(inputDataDM.value)) return;
                select.value = '';
                divDataOuMotivo.style.display = 'none';
                inputDataDM.value = '';
                inputMotivoDM.value = '';
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
    // Substitui o texto com o valor do campo adicional
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
    // PARTE 2: LEITURA E INJEÇÃO DAS TAGS DE PRIORIDADE
    // ==========================================
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
        const m = String(textoCelula).trim().match(/(\d+)/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        return (n >= 1 && n <= 11) ? n : null;
    }
    function processarDadosPlanilha(linhasCsv) {
        if (linhasCsv.length < 2) return;
        let headerIdx = -1;
        for (let i = 0; i < Math.min(5, linhasCsv.length); i++) {
            if (!linhasCsv[i] || !Array.isArray(linhasCsv[i])) continue;
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
        const idxData = header.findIndex(h => h.includes("DATA") || h.includes("INCLU") || h.includes("ENTRAD") || h.includes("DISTRIB"));

        if (idxTipo < 0) {
            idxTipo = header.findIndex(h => h.includes("ORIGEM") || h.includes("PRIO"));
        }

        BANCO_PRIORIDADES.clear();
        dados.forEach(row => {
            const npuBruto = row[idxNPU >= 0 ? idxNPU : 0];
            const npuChave = limparNPU(npuBruto);
            if (npuChave.length < 8) return;
            const chaveCurta = npuChave.substring(0, 8); // Chave curta de 8 dígitos
            let prioridadeIdentificada = 1;
            if (idxTipo >= 0) {
                prioridadeIdentificada = extrairPrioridade(row[idxTipo]) || 1;
            } else {
                for (let i = 0; i < row.length; i++) {
                    if (i === idxNPU || i === idxData) continue;
                    const p = extrairPrioridade(row[i]);
                    if (p) { prioridadeIdentificada = p; break; }
                }
            }
            const dataStr = idxData >= 0 ? row[idxData] : null;
            BANCO_PRIORIDADES.set(chaveCurta, {
                prioridade: prioridadeIdentificada,
                data: dataStr
            });
        });

        console.log("😸 [Tontom] Planilha carregada. Itens no banco de prioridades:", BANCO_PRIORIDADES.size);
        aplicarTagsNaTela();
    }
    function carregarDadosPlanilha() {
        const { id, gid } = extrairIdEAbas(URL_PLANILHA);
        if (!id) return;
        const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;

        // Tenta baixar com fetch comum primeiro
        fetch(csvUrl)
            .then(res => {
                if (res.ok) return res.text();
                throw new Error("Erro de requisição");
            })
            .then(text => {
                const matriz = parsearCSV(text);
                processarDadosPlanilha(matriz);
            })
            .catch(err => {
                console.log("😸 [Tontom] Fetch direto falhou (CORS/Offline). Tentando GM_xmlhttpRequest...", err);

                // Fallback para GM_xmlhttpRequest
                GM_xmlhttpRequest({
                    method: "GET",
                    url: csvUrl,
                    onload: function(response) {
                        if (response.status === 200) {
                            const matriz = parsearCSV(response.responseText);
                            processarDadosPlanilha(matriz);
                        } else {
                            console.error("😸 [Tontom] GM_xmlhttpRequest falhou:", response.status);
                        }
                    },
                    onerror: function(err) {
                        console.error("😸 [Tontom] GM_xmlhttpRequest erro:", err);
                    }
                });
            });
    }
    function aplicarTagsNaTela() {
        if (BANCO_PRIORIDADES.size === 0) return;
        // Regex mais abrangente para pegar tanto NPUs curtos (como 0014040-6) quanto longos (0014040-62.2019.8.17.2001)
        const regexNPU = /\b\d{7}[-.]?\d{1,2}([-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4})?\b/g;
        const elementos = document.querySelectorAll("td, span, a, div.ui-outputpanel");
        elementos.forEach(el => {
            if (el.closest('#containerMenuTontom')) return;
            if (el.querySelector(".tag-prioridade") || el.classList.contains("tag-prioridade")) return;
            if (el.childNodes.length > 0) {
                for (let node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE && regexNPU.test(node.nodeValue)) {
                        const correspondencias = node.nodeValue.match(regexNPU);
                        if (correspondencias) {
                            correspondencias.forEach(npuMatch => {
                                const chave = limparNPU(npuMatch);
                                if (chave.length < 8) return;
                                const chaveCurta = chave.substring(0, 8); // Matching por prefixo de 8 dígitos
                                if (BANCO_PRIORIDADES.has(chaveCurta)) {
                                    const p = BANCO_PRIORIDADES.get(chaveCurta);
                                    const pValue = typeof p === 'object' ? p.prioridade : p;
                                    const tag = document.createElement("span");
                                    tag.className = `tag-prioridade prio-p${pValue}`;
                                    tag.textContent = `P${pValue}`;
                                    tag.title = `Prioridade Nível P${pValue}`;
                                    el.appendChild(tag);
                                }
                            });
                        }
                    }
                }
            }
        });
    }
    // Inicialização
    mostrarAvisoCarregamento();
    carregarDadosPlanilha();
    const observer = new MutationObserver((mutations) => {
        const apenasNossaObs = mutations.every(m => m.target.closest('#containerMenuTontom'));
        if (apenasNossaObs) return;
        aplicarTagsNaTela();
        injetarMenuFlutuante();
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    setInterval(() => {
        aplicarTagsNaTela();
        injetarMenuFlutuante();
    }, 1500);
})();
