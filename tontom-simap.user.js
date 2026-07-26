// ==UserScript==
// @name         Tontom-Simap (Servidor)
// @namespace    simap-tjpe
// @version      2.3
// @description  Menu de observações, Prioridades, painel móvel com fila de trabalho consolidada, filtros, botões de cópia individual, sincronização em tempo real e redirecionamento de foco por página.
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

        dados.forEach(row => {
            const npuBruto = row[idxNPU >= 0 ? idxNPU : 0];
            const npuChave = limparNPU(npuBruto);
            if (npuChave.length !== 20) return;
            
            let prioridadeIdentificada = 1;
            let tagEspecialIdentificada = null;

            if (idxTipo >= 0) {
                prioridadeIdentificada = extrairPrioridade(row[idxTipo]) || 1;
                tagEspecialIdentificada = extrairTagEspecial(row[idxTipo]);
            } else {
                for (let i = 0; i < row.length; i++) {
                    if (i === idxNPU) continue;
                    const p = extrairPrioridade(row[i]);
                    if (p) prioridadeIdentificada = p;
                    const tagEsp = extrairTagEspecial(row[i]);
                    if (tagEsp) tagEspecialIdentificada = tagEsp;
                    if (p && tagEsp) break;
                }
            }
            BANCO_PRIORIDADES.set(npuChave, {
                prioridade: prioridadeIdentificada,
                tagEspecial: tagEspecialIdentificada
            });
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
                                    const item = BANCO_PRIORIDADES.get(chave);
                                    const pStr = typeof item === 'object' ? item.prioridade : item;
                                    const tagEspecial = typeof item === 'object' ? item.tagEspecial : null;
                                    const pBase = parseInt(pStr, 10); // Extrai apenas a base inteira (ex: 4)

                                    const tag = document.createElement("span");
                                    tag.className = `tag-prioridade prio-p${pBase}`; // Usa a cor do grupo base
                                    tag.textContent = `P-${pStr}`; // Adiciona o tracinho separador

                                    tag.title = `Prioridade Nível P${pStr}`;
                                    el.appendChild(tag);

                                    if (tagEspecial) {
                                        const tagEspNode = document.createElement("span");
                                        const classeTipo = tagEspecial.startsWith("Saldo") ? "tag-saldo" : "tag-incon";
                                        tagEspNode.className = `tag-prioridade ${classeTipo}`;
                                        tagEspNode.textContent = tagEspecial;
                                        tagEspNode.title = tagEspecial;
                                        el.appendChild(tagEspNode);
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
        { display: "*PRAZO ABERTO FORA DO SISTEMA (Data de Retorno)", prefixo: "*PRAZO ABERTO FORA DO SISTEMA", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno" },
        { display: "*PRAZO EM CURSO NO SISTEMA", prefixo: "*PRAZO EM CURSO NO SISTEMA", precisaExtra: false },
        { display: "*PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação - informar nº)", prefixo: "*PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação)", precisaExtra: true, labelExtra: "Informe o Nº do Tema/Ação Conexa:", rotuloExtra: "Nº" },
        { display: "*PROCESSO SUSPENSO (Determinação judicial - informar data de retorno)", prefixo: "*PROCESSO SUSPENSO (Determinação judicial)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno" },
        { display: "*PROCESSO SUSPENSO (Resposta de Precatória - PC 03/2021)", prefixo: "*PROCESSO SUSPENSO (Resposta de Precatória - PC 03/2021)", precisaExtra: false },
        { display: "*PROCESSO SUSPENSO (Julg. Agravo/Conflito de competência - informar nº)", prefixo: "*PROCESSO SUSPENSO (Julg. Agravo/Conflito de competência)", precisaExtra: true, labelExtra: "Informe o Nº do processo:", rotuloExtra: "Nº" },
        { display: "*ARQUIVO PROVISÓRIO (Data de retorno OU Motivo)", prefixo: "*ARQUIVO PROVISÓRIO", precisaExtra: true, labelExtra: "Informe a Data ou Motivo:", rotuloExtra: "Info" },
        { display: "*ERRO DE FLUXO (Nº do Chamado)", prefixo: "*ERRO DE FLUXO", precisaExtra: true, labelExtra: "Informe o Nº do Chamado:", rotuloExtra: "Chamado" },
        { display: "*LEILÃO", prefixo: "*LEILÃO", precisaExtra: false },
        { display: "*REC. JUD./FALÊNCIA (não engloba habilitação de crédito)", prefixo: "*REC. JUD./FALÊNCIA (não engloba habilitação de crédito)", precisaExtra: false },
        { display: "*PRECATÓRIO/RPV", prefixo: "*PRECATÓRIO/RPV", precisaExtra: false },
        { display: "*CENTRAL DE AGILIZAÇÃO (SEM FLUXO)", prefixo: "*CENTRAL DE AGILIZAÇÃO (SEM FLUXO)", precisaExtra: false },
        { display: "*INTEGRALMENTE CUMPRIDO POR OUTRO SERVIDOR", prefixo: "*INTEGRALMENTE CUMPRIDO POR OUTRO SERVIDOR", precisaExtra: false }
    ];

    let textoPrevioAoSelect = "";

    function injetarMenuFlutuante() {
        const txtAreaOriginal = document.getElementById('field_observacao');
        if (!txtAreaOriginal || document.getElementById('containerMenuTontom')) return;

        // Detecta se a servidora Thamyris Ferreira Santos está logada
        const docText = document.body.innerText || "";
        const isThamyris = docText.includes("THAMYRIS FERREIRA") || docText.includes("Thamyris Ferreira") || docText.includes("thamyris ferreira");

        let opcoesMenu = [...opcoesPadrao];
        if (isThamyris) {
            opcoesMenu.push({
                display: "*IMPEDIMENTO DO CUMPRIMENTO (selecionar tipo)",
                prefixo: "*IMPEDIMENTO DO CUMPRIMENTO",
                precisaImpedimento: true
            });
        }

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

        opcoesMenu.forEach((opt, index) => {
            const o = document.createElement('option');
            o.value = index;
            o.innerText = opt.display;
            select.appendChild(o);
        });
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

        divExtra.appendChild(labelExtra);
        divExtra.appendChild(inputExtra);
        container.appendChild(divExtra);

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

        // Lógica de seleção do menu padronizado
        select.addEventListener('change', function() {
            const idx = this.value;
            if (idx === '') {
                divExtra.style.display = 'none';
                inputExtra.value = '';
                divImpedimento.style.display = 'none';
                selectImp.value = '';
                return;
            }

            const opcaoSelecionada = opcoesMenu[idx];
            textoPrevioAoSelect = txtAreaOriginal.value.trim();

            // Lógica do Impedimento (Thamyris)
            if (opcaoSelecionada.precisaImpedimento) {
                divExtra.style.display = 'none';
                inputExtra.value = '';
                divImpedimento.style.display = 'block';
                selectImp.value = '';
                selectImp.focus();

                acumularTextoOficial(opcaoSelecionada.prefixo);
            } 
            // Lógica do Campo Aberto (Normal)
            else if (opcaoSelecionada.precisaExtra) {
                divImpedimento.style.display = 'none';
                selectImp.value = '';
                labelExtra.innerText = opcaoSelecionada.labelExtra;
                divExtra.style.display = 'block';
                inputExtra.value = '';
                inputExtra.focus();

                acumularTextoOficial(opcaoSelecionada.prefixo);
            } 
            // Opções Simples
            else {
                divImpedimento.style.display = 'none';
                selectImp.value = '';
                divExtra.style.display = 'none';
                inputExtra.value = '';

                const textoFinal = opcaoSelecionada.cleanText || opcaoSelecionada.prefixo;
                acumularTextoOficial(textoFinal);
                select.value = '';
            }
        });

        // Lógica do campo aberto texto
        inputExtra.addEventListener('input', function() {
            const idx = select.value;
            if (idx === '') return;

            const opcaoSelecionada = opcoesMenu[idx];
            const infoAdicional = this.value.trim();
            const textoTermo = infoAdicional ? `${opcaoSelecionada.prefixo} | ${opcaoSelecionada.rotuloExtra}: ${infoAdicional}` : opcaoSelecionada.prefixo;

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
                        <tr id="row-p1-saldo" style="background:#fcfcfc; font-size:11px; color:#059669;">
                            <td style="padding-left:8px; text-align:left; font-weight:bold;">↳ Saldo</td>
                            <td id="p1-saldo-total">-</td><td id="p1-saldo-fin">-</td><td id="p1-saldo-and">-</td><td id="p1-saldo-pen">-</td><td id="p1-saldo-notif">-</td>
                            <td id="p1-saldo-alerta" style="text-align:left; padding-left:6px; font-style:italic;">-</td>
                        </tr>
                        <tr id="row-p1-incon" style="background:#fcfcfc; font-size:11px; color:#d97706;">
                            <td style="padding-left:8px; text-align:left; font-weight:bold;">↳ INCON</td>
                            <td id="p1-incon-total">-</td><td id="p1-incon-fin">-</td><td id="p1-incon-and">-</td><td id="p1-incon-pen">-</td><td id="p1-incon-notif">-</td>
                            <td id="p1-incon-alerta" style="text-align:left; padding-left:6px; font-style:italic;">-</td>
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

                <!-- Seção de Meus Processos Consolidada com Filtros Dinâmicos -->
                <div id="wrapperFilaTrabalho" style="margin-top: 12px; border-top: 1px dotted #ccc; padding-top: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: bold; font-size: 13px; color: #495057;">📋 Meus Processos (Todas as Páginas)</span>
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
    function recalcularContadoresGlobais() {
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

                    if (p.tagEspecial) {
                        const sub = p.tagEspecial.startsWith("Saldo") ? contadoresPrio[nivelPrioBase].saldo : contadoresPrio[nivelPrioBase].incon;
                        sub.total++;
                        sub.notif += p.notif;
                        if (p.status === "Finalizado") sub.fin++;
                        else if (p.status === "Em andamento") sub.and++;
                    }
                }
            }
        });

        atualizarValoresPainel(totalGeral, finGeral, andGeral, notifGeral, false);
    }

    // Atualiza a visualização de Meus Processos com botões de ação corretos e filtros dinâmicos
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
                    Clique em "📊 Gerar Contadores" para varrer todas as páginas e montar Meus Processos.
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

            // O NPU vira um link interno limpo
            const linkDisplay = `<a href="#" class="npu-link-click" data-chave="${p.chave}" data-pagina="${p.pagina}" title="Ir para este processo na Tabela do SIMAP (Pág ${p.pagina})" style="color:#0d6efd; font-weight:bold; text-decoration:underline; cursor:pointer;">${p.npu}</a>`;
            
            // Botão de copiar o número limpo ao lado do processo
            const botaoCopiar = `<button class="btn-copiar-npu" data-npu="${p.npu}" title="Copiar número do processo para colar no PJe" style="margin-left: 6px; padding: 1px 4px; font-size: 10px; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 3px; font-family: sans-serif; transition: background 0.15s;">📋</button>`;

            let statusCor = "#6c757d";
            if (p.status === "Finalizado") statusCor = "#157347";
            else if (p.status === "Em andamento") statusCor = "#0d6efd";

            html += `
                <tr style="border-bottom:1px solid #dee2e6; background:#fff; height:24px;">
                    <td style="padding:4px; text-align:center;"><span style="${tagEstilo}">P${p.prioridade}</span></td>
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
            contadoresPrio[i] = {
                total: 0, fin: 0, and: 0, pen: 0, notif: 0,
                saldo: { total: 0, fin: 0, and: 0, pen: 0, notif: 0 },
                incon: { total: 0, fin: 0, and: 0, pen: 0, notif: 0 }
            };
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

        ['saldo', 'incon'].forEach(tipo => {
            const elTot = document.getElementById(`p1-${tipo}-total`);
            if (elTot) {
                elTot.innerText = "⏳";
                document.getElementById(`p1-${tipo}-fin`).innerText = "⏳";
                document.getElementById(`p1-${tipo}-and`).innerText = "⏳";
                document.getElementById(`p1-${tipo}-pen`).innerText = "⏳";
                document.getElementById(`p1-${tipo}-notif`).innerText = "⏳";
                document.getElementById(`p1-${tipo}-alerta`).innerText = "-";
            }
        });

        resetarContadoresPrioridade();
        processosVarridos = [];
        atualizarFilaTrabalhoPainel("Iniciando a varredura...");

        const firstBtn = document.querySelector('.p-paginator-first, .ui-paginator-first, [aria-label="Primeira Página"], [aria-label="First Page"]');
        if (firstBtn && !firstBtn.disabled && firstBtn.getAttribute('aria-disabled') !== 'true') {
            firstBtn.click();
            await esperar(1800);
        }

        let totalGeral = 0;
        let finGeral = 0;
        let andGeral = 0;
        let notifGeral = 0;
        let paginaAtual = 1;
        const processosMapeados = new Set();
        const regexValidaNPU = /\d{7}[-.]?\d{2}[-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4}/;

        while (true) {
            if (abortarVarredura) break;
            while (varreduraPausada) {
                await esperar(500);
                if (abortarVarredura) break;
            }
            if (abortarVarredura) break;

            atualizarFilaTrabalhoPainel(`Varrendo processos da Página ${paginaAtual}...`);

            const linhas = document.querySelectorAll('tr[data-cy="entityTable"], tbody tr');

            linhas.forEach(linha => {
                const textoLinha = childText(linha);
                if (!textoLinha || textoLinha.includes("Nenhum registro encontrado")) return;
                
                const matchNPU = textoLinha.match(regexValidaNPU);
                if (!matchNPU) return;

                const npuFormatado = matchNPU[0];
                const chaveNpu = limparNPU(npuFormatado);

                if (processosMapeados.has(chaveNpu)) return;
                processosMapeados.add(chaveNpu);

                totalGeral++;

                const livros = inlinePiBooks(linha);
                const qtdLivrosNaLinha = livros.length;
                notifGeral += qtdLivrosNaLinha;

                let isFin = false;
                let isAnd = false;
                let statusText = "Pendente";
                const dp = inlineDropdownText(linha);
                if (dp) {
                    if (dp.includes("Finalizado")) { finGeral++; isFin = true; statusText = "Finalizado"; }
                    else if (dp.includes("Em andamento")) { andGeral++; isAnd = true; statusText = "Em andamento"; }
                }

                let prioridadeIdentificada = null;
                let tagEspecialIdentificada = null;
                if (BANCO_PRIORIDADES.has(chaveNpu)) {
                    const item = BANCO_PRIORIDADES.get(chaveNpu);
                    prioridadeIdentificada = typeof item === 'object' ? item.prioridade : item;
                    tagEspecialIdentificada = typeof item === 'object' ? item.tagEspecial : null;
                    const nivelPrioBase = parseInt(prioridadeIdentificada, 10);

                    if (nivelPrioBase >= 1 && nivelPrioBase <= 4) {
                        contadoresPrio[nivelPrioBase].total++;
                        contadoresPrio[nivelPrioBase].notif += qtdLivrosNaLinha;
                        if (isFin) contadoresPrio[nivelPrioBase].fin++;
                        else if (isAnd) contadoresPrio[nivelPrioBase].and++;

                        if (tagEspecialIdentificada) {
                            const sub = tagEspecialIdentificada.startsWith("Saldo") ? contadoresPrio[nivelPrioBase].saldo : contadoresPrio[nivelPrioBase].incon;
                            sub.total++;
                            sub.notif += qtdLivrosNaLinha;
                            if (isFin) sub.fin++;
                            else if (isAnd) sub.and++;
                        }
                    }
                }

                const parsedPrio = prioridadeIdentificada ? parseFloat(String(prioridadeIdentificada).replace(',', '.')) : 999;

                processosVarridos.push({
                    npu: npuFormatado,
                    chave: chaveNpu,
                    prioridade: prioridadeIdentificada || "S/P",
                    tagEspecial: tagEspecialIdentificada || null,
                    prioValor: parsedPrio,
                    status: statusText,
                    notif: qtdLivrosNaLinha,
                    pagina: paginaAtual
                });
            });

            atualizarValoresPainel(totalGeral, finGeral, andGeral, notifGeral, true);

            const nextBtn = document.querySelector('.p-paginator-next, .ui-paginator-next, [aria-label="Página Seguinte"], [aria-label="Next Page"]');
            if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute('aria-disabled') === 'true') break;

            nextBtn.click();
            paginaAtual++;
            await esperar(1800);
        }

        varreduraAtiva = false;
        atualizarBotoesUI();
        atualizarValoresPainel(totalGeral, finGeral, andGeral, notifGeral, false);
        atualizarFilaTrabalhoPainel();
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

        for (let i = 1; i <= 4; i++) {
            contadoresPrio[i].pen = contadoresPrio[i].total - (contadoresPrio[i].fin + contadoresPrio[i].and);
        }

        // Atualiza subcontadores de Saldo e INCON (exclusivo para P1)
        ['saldo', 'incon'].forEach(tipo => {
            const sub = contadoresPrio[1][tipo];
            sub.pen = sub.total - (sub.fin + sub.and);
            const elTot = document.getElementById(`p1-${tipo}-total`);
            if (elTot) {
                elTot.innerText = sub.total;
                document.getElementById(`p1-${tipo}-fin`).innerText = sub.fin;
                document.getElementById(`p1-${tipo}-and`).innerText = sub.and;
                const elPen = document.getElementById(`p1-${tipo}-pen`);
                elPen.innerText = sub.pen >= 0 ? sub.pen : 0;
                elPen.style.color = sub.pen > 0 ? "#b02a37" : "#157347";
                document.getElementById(`p1-${tipo}-notif`).innerText = sub.notif;
                const elAl = document.getElementById(`p1-${tipo}-alerta`);
                if (sub.total === 0) {
                    elAl.innerText = "-";
                } else if (sub.pen === 0) {
                    elAl.innerText = "✅ Concluído";
                } else {
                    elAl.innerText = `▶️ ${sub.pen} pendente(s)`;
                }
            }
        });

        // Nova Lógica de Alertas Inteligentes com Cascata Flexível
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

            let bloqueadoPorPrioAcima = false;
            let maiorBloqueador = null;

            for (let j = 1; j < i; j++) {
                if (contadoresPrio[j].total > 0 && contadoresPrio[j].pen > 0) {
                    bloqueadoPorPrioAcima = true;
                    maiorBloqueador = j;
                    break;
                }
            }

            if (bloqueadoPorPrioAcima) {
                elAlerta.innerText = `⚠️ Atenção! Cumpra P${maiorBloqueador} primeiro.`;
                elAlerta.style.color = "#dc3545";
            } else {
                if (pData.fin === pData.total) {
                    elAlerta.innerText = (i === 1) ? "✅ Lote 100% Concluído" : "✅ Concluído";
                    elAlerta.style.color = "#157347";
                } else if (pData.pen > 0) {
                    elAlerta.innerText = (i === 1) ? "🎯 Há pendências na fila de P1" : "▶️ Liberado para cumprir";
                    elAlerta.style.color = (i === 1) ? "#d63384" : "#0d6efd";
                } else {
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
