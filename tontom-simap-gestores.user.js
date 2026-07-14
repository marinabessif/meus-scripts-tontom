// ==UserScript==
// @name          Tontom-Simap - Gestores 
// @namespace     simap-tjpe
// @version      1.7
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
        { display: "SUPERVISÃO/DÚVIDA (campo aberto)", prefixo: "SUPERVISÃO/DÚVIDA", precisaExtra: true, labelExtra: "Digite o motivo ou a dúvida:", rotuloExtra: "Detalhe" },
        { display: "*SERVIDOR (campo aberto)", prefixo: "*SERVIDOR", precisaExtra: true, labelExtra: "Digite o lembrete/observação interna:", rotuloExtra: "Lembrete" },
        { display: "*SISCONDJ (Alvará gravado)", prefixo: "*SISCONDJ (Alvará gravado)", precisaExtra: false },
        { display: "*SISCONDJ (Vinculação de Conta)", prefixo: "*SISCONDJ (Vinculação de Conta)", precisaExtra: false },
        { display: "*PRAZO ABERTO FORA DO SISTEMA (Data de Retorno)", prefixo: "*PRAZO ABERTO FORA DO SISTEMA", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno" },
        { display: "*PRAZO EM CURSO NO SISTEMA", prefixo: "*PRAZO EM CURSO NO SISTEMA", precisaExtra: false },
        { display: "*PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação - informar nº)", prefixo: "*PROCESSO SUSPENSO (Tema/Ação Conexa/Outra ação)", precisaExtra: true, labelExtra: "Informe o Nº do Tema/Ação Conexa:", rotuloExtra: "Nº" },
        { display: "*PROCESSO SUSPENSO (Determinação judicial - informar data de retorno)", prefixo: "*PROCESSO SUSPENSO (Determinação judicial)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno" },
        { display: "*PROCESSO SUSPENSO (Data de Retorno)", prefixo: "*PROCESSO SUSPENSO (Data de Retorno)", precisaExtra: true, labelExtra: "Informe a Data de Retorno:", rotuloExtra: "Data de Retorno" },
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
            o.innerText = opt.display;
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

                acumularTextoOficial(opcaoSelecionada.prefixo);
            } else {
                divExtra.style.display = 'none';
                inputExtra.value = '';

                const textoFinal = opcaoSelecionada.cleanText || opcaoSelecionada.prefixo;
                acumularTextoOficial(textoFinal);
                select.value = '';
            }
        });

        inputExtra.addEventListener('input', function() {
            const idx = select.value;
            if (idx === '') return;

            const opcaoSelecionada = opcoesPadrao[idx];
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
                                    const basePrio = parseInt(pValue, 10) || 9;
                                    const tag = document.createElement("span");
                                    tag.className = `tag-prioridade prio-p${basePrio}`;
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

    // ==========================================
    // PARTE 3: BOTÃO FLUTUANTE "COLAR NPU E BUSCAR" + VISUAL DEBUGGER LOGS
    // ==========================================
    
    // Função para mostrar logs visuais na tela
    function mostrarLogVisual(msg, cor = '#1a73e8') {
        let box = document.getElementById('tontomLogVisual');
        if (!box) {
            box = document.createElement('div');
            box.id = 'tontomLogVisual';
            box.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                background: rgba(0,0,0,0.85);
                color: #fff;
                padding: 15px 20px;
                border-radius: 8px;
                font-family: sans-serif;
                font-size: 13px;
                z-index: 100000;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                max-width: 300px;
                border-left: 5px solid ${cor};
                transition: all 0.3s ease;
            `;
            document.body.appendChild(box);
        }
        box.style.borderLeftColor = cor;
        box.innerHTML = `<div style="font-weight:bold; margin-bottom:5px; color:${cor}">😸 Tontom Status:</div><div>${msg}</div>`;
        
        // Remove após 5 segundos se for mensagem de sucesso ou erro final
        if (cor !== '#1a73e8' && cor !== '#e65100') { // se for verde ou vermelho
            setTimeout(() => {
                if (box && box.parentNode) box.remove();
            }, 5000);
        }
    }

    // Helper: Localizar o input NPU no DOM
    function localizarInputNPU() {
        const inputs = Array.from(document.querySelectorAll('input'));
        
        // Método A: Busca direta por atributos do input
        for (const input of inputs) {
            const id = String(input.id || "").toLowerCase();
            const name = String(input.name || "").toLowerCase();
            const placeholder = String(input.placeholder || "").toLowerCase();
            const ariaLabel = String(input.getAttribute("aria-label") || "").toLowerCase();
            
            if (id.includes("npu") || id.includes("processo") || 
                name.includes("npu") || name.includes("processo") || 
                placeholder.includes("npu") || placeholder.includes("processo") ||
                ariaLabel.includes("npu") || ariaLabel.includes("processo")) {
                if (input.offsetParent !== null || input.offsetWidth > 0) return input;
            }
        }
        
        // Método B: Busca pelo texto do label associado
        const labels = Array.from(document.querySelectorAll('label, mat-label, span, mat-placeholder, p'));
        for (const lbl of labels) {
            const text = String(lbl.innerText || lbl.textContent || "").trim().toUpperCase();
            if (text === "NPU" || text === "NPU:" || text === "PROCESSO" || text === "PROCESSO:" || text === "Nº PROCESSO" || text === "N° DO PROCESSO") {
                const forAttr = lbl.getAttribute('for');
                if (forAttr) {
                    const inp = document.getElementById(forAttr);
                    if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) return inp;
                }
                
                // Procura inputs próximos subindo a árvore
                let container = lbl.parentElement;
                for (let d = 0; d < 5; d++) {
                    if (!container || container.tagName === 'BODY') break;
                    const found = container.querySelector('input:not([type="hidden"])');
                    if (found && (found.offsetParent !== null || found.offsetWidth > 0)) return found;
                    container = container.parentElement;
                }
            }
        }

        // Método C: Se houver apenas um input visível na tela inteira
        const visibleInputs = inputs.filter(inp => inp.type !== "hidden" && (inp.offsetParent !== null || inp.offsetWidth > 0));
        if (visibleInputs.length === 1) {
            return visibleInputs[0];
        }
        
        return null;
    }
    
    // Helper: Preencher input de forma compatível com Angular/React framework
    function preencherInputAngular(input, valor) {
        input.focus();
        try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, valor);
        } catch(e) {
            input.value = valor;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        input.value = valor;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // Helper: Expandir filtros e preencher NPU
    function expandirFiltrosEBuscar(npu) {
        mostrarLogVisual("Iniciando busca automática do NPU " + npu, "#1a73e8");
        
        let fase1Count = 0;
        let filtroClicado = false;
        
        const fase1 = setInterval(() => {
            fase1Count++;
            
            // Timeout após ~10 segundos (33 * 300ms)
            if (fase1Count > 33) { 
                clearInterval(fase1); 
                
                // DIAGNÓSTICO: Coleta todos os inputs da tela para ajudar a descobrir o problema
                const inputsEncontrados = Array.from(document.querySelectorAll('input')).map(inp => {
                    return `[ID:${inp.id || 'sem-id'} | PlaceH:${inp.placeholder || 'sem-plh'} | Vis:${inp.offsetParent !== null}]`;
                }).slice(0, 5).join('<br>');
                
                mostrarLogVisual(
                    `Tempo esgotado.<br><b>Inputs na tela:</b><br>${inputsEncontrados || 'Nenhum input encontrado'}`, 
                    "#e53935"
                );
                return; 
            }
            
            // Verifica se o input já apareceu
            const inputExistente = localizarInputNPU();
            if (inputExistente) {
                clearInterval(fase1);
                mostrarLogVisual("Input NPU localizado! Preenchendo dados...", "#1a73e8");
                preencherInputAngular(inputExistente, npu);
                
                // Vai para a fase de clicar em pesquisar
                setTimeout(() => clicarPesquisar(inputExistente), 600);
                return;
            }
            
            // Se ainda não achou o input e ainda não clicou em Filtros, clica uma vez
            if (!filtroClicado) {
                mostrarLogVisual("Painel de filtros fechado. Tentando abrir...", "#f57c00");
                
                // Busca ampla por botões ou clickables que contenham "filtro" no texto
                const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], .mat-focus-indicator, .btn'));
                const btnFiltro = clickables.find(el => {
                    const text = String(el.innerText || el.textContent || "").trim().toLowerCase();
                    return text.includes("filtro");
                });
                
                if (btnFiltro) {
                    filtroClicado = true;
                    
                    // Sobe na árvore DOM para achar o botão real mais próximo
                    let alvo = btnFiltro;
                    let p = btnFiltro;
                    for (let i = 0; i < 5; i++) {
                        p = p.parentElement;
                        if (!p || p.tagName === 'BODY') break;
                        if (p.tagName === 'BUTTON' || p.tagName === 'A' || p.getAttribute('role') === 'button') {
                            alvo = p; 
                            break;
                        }
                    }
                    
                    // Clica no botão
                    if (alvo !== btnFiltro) {
                        alvo.click();
                    } else {
                        btnFiltro.click();
                    }
                    mostrarLogVisual("Botão Filtros clicado! Aguardando renderização...", "#f57c00");
                } else {
                    mostrarLogVisual("Procurando botão Filtros na tela...", "#f57c00");
                }
            }
        }, 300);
    }
    
    // Helper: Clicar no botão Pesquisar
    function clicarPesquisar(inputRef) {
        mostrarLogVisual("Preenchido! Procurando botão Pesquisar...", "#1a73e8");
        let count = 0;
        
        const interval = setInterval(() => {
            count++;
            if (count > 15) {
                clearInterval(interval);
                // Fallback: tenta submeter o formulário
                const form = inputRef ? inputRef.closest('form') : null;
                if (form) {
                    mostrarLogVisual("Submetendo formulário como fallback...", "#f57c00");
                    form.submit();
                } else {
                    mostrarLogVisual("Não foi possível encontrar o botão de pesquisar.", "#e53935");
                }
                return;
            }
            
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a, [role="button"]'));
            for (const btn of buttons) {
                const t = String(btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
                const cls = String(btn.className || "").toLowerCase();
                const id = String(btn.id || "").toLowerCase();
                
                // Verifica texto comum de pesquisa OU classe/id que contenha termos de busca
                const matchesText = t.includes("pesquisar") || t.includes("buscar") || t.includes("filtrar") || t === "consultar" || t === "ok";
                const matchesClass = cls.includes("search") || cls.includes("find") || cls.includes("lupa") || cls.includes("filtrar");
                const matchesId = id.includes("search") || id.includes("find") || id.includes("buscar");
                
                if ((matchesText || matchesClass || matchesId) && (btn.offsetParent !== null || btn.offsetWidth > 0)) {
                    clearInterval(interval);
                    mostrarLogVisual("Botão Pesquisar encontrado! Executando busca...", "#2e7d32");
                    btn.click();
                    return;
                }
            }
        }, 250);
    }
    
    // ---- BOTÃO FLUTUANTE "COLAR NPU E BUSCAR" ----
    function criarBotaoColaNPU() {
        if (document.getElementById('tontomBtnColaNPU')) return;
        
        const btn = document.createElement('div');
        btn.id = 'tontomBtnColaNPU';
        btn.innerHTML = '📋 Colar NPU e Buscar';
        btn.title = 'Cole o NPU da área de transferência, preencha automaticamente e busque no SIMAP (Arraste para mover)';
        btn.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: linear-gradient(135deg, #1a73e8, #0d47a1);
            color: #fff;
            padding: 12px 20px;
            border-radius: 30px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            z-index: 99999;
            user-select: none;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        `;
        
        // Aplica posição salva se existir
        const salvoTop = localStorage.getItem('tontomBtnColaNPU_top');
        const salvoLeft = localStorage.getItem('tontomBtnColaNPU_left');
        if (salvoTop && salvoLeft) {
            btn.style.bottom = 'auto';
            btn.style.right = 'auto';
            btn.style.top = salvoTop;
            btn.style.left = salvoLeft;
        }
        
        btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)'; };
        btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)'; };
        
        // Lógica de arrastar (Drag and Drop)
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        let arrastou = false;
        let startX = 0, startY = 0;
        
        btn.onmousedown = (e) => {
            if (e.button !== 0) return; // Apenas botão esquerdo do mouse
            arrastou = false;
            startX = e.clientX;
            startY = e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            btn.style.cursor = 'grabbing';
        };
        
        function elementDrag(e) {
            e.preventDefault();
            // Se mover mais do que 6 pixels, ativa flag de arrasto
            if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) {
                arrastou = true;
            }
            
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            btn.style.bottom = 'auto';
            btn.style.right = 'auto';
            btn.style.top = (btn.offsetTop - pos2) + "px";
            btn.style.left = (btn.offsetLeft - pos1) + "px";
        }
        
        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
            btn.style.cursor = 'pointer';
            
            // Salva a nova posição
            localStorage.setItem('tontomBtnColaNPU_top', btn.style.top);
            localStorage.setItem('tontomBtnColaNPU_left', btn.style.left);
        }
        
        btn.onclick = async (e) => {
            if (arrastou) {
                // Impede o clique de disparar se o botão foi arrastado
                arrastou = false;
                return;
            }
            
            try {
                // Tenta ler o clipboard
                const textoClipboard = await navigator.clipboard.readText();
                // Limpa o NPU: mantém apenas dígitos, pontos e traços
                const npuLimpo = textoClipboard.replace(/[^\d.-]/g, '').trim();
                
                if (!npuLimpo || npuLimpo.length < 5) {
                    mostrarLogVisual("Área de transferência não contém um NPU válido.", "#e53935");
                    btn.innerHTML = '❌ NPU inválido';
                    btn.style.background = 'linear-gradient(135deg, #e53935, #b71c1c)';
                    setTimeout(() => {
                        btn.innerHTML = '📋 Colar NPU e Buscar';
                        btn.style.background = 'linear-gradient(135deg, #1a73e8, #0d47a1)';
                    }, 2000);
                    return;
                }
                
                const targetUrl = `https://simap.svc.tjpe.jus.br/historico-servidor-processo#npu=${npuLimpo}`;
                const isCorrectPage = window.location.hostname === 'simap.svc.tjpe.jus.br' && window.location.pathname.includes('/historico-servidor-processo');
                
                if (isCorrectPage) {
                    btn.innerHTML = '⏳ Buscando...';
                    btn.style.background = 'linear-gradient(135deg, #43a047, #2e7d32)';
                    
                    window.location.hash = `npu=${npuLimpo}`;
                    expandirFiltrosEBuscar(npuLimpo);
                    
                    setTimeout(() => {
                        btn.innerHTML = '📋 Colar NPU e Buscar';
                        btn.style.background = 'linear-gradient(135deg, #1a73e8, #0d47a1)';
                    }, 3000);
                } else {
                    btn.innerHTML = '⏳ Redirecionando...';
                    btn.style.background = 'linear-gradient(135deg, #f57c00, #e65100)';
                    window.location.href = targetUrl;
                }
                
            } catch(err) {
                console.error("😸 [Tontom] Erro ao ler clipboard:", err);
                mostrarLogVisual("Erro ao ler área de transferência. Dica: Clique na página para dar foco antes de clicar no botão.", "#f57c00");
                btn.innerHTML = '⚠️ Erro ao colar';
                btn.style.background = 'linear-gradient(135deg, #f57c00, #e65100)';
                setTimeout(() => {
                    btn.innerHTML = '📋 Colar NPU e Buscar';
                    btn.style.background = 'linear-gradient(135deg, #1a73e8, #0d47a1)';
                }, 3000);
            }
        };
        
        document.body.appendChild(btn);
    }
    
    // Injeta o botão flutuante periodicamente (para SPAs Angular que recarregam o DOM)
    setInterval(criarBotaoColaNPU, 2000);
    criarBotaoColaNPU();
    
    // ---- HASH DETECTION (bônus: funciona quando abre no mesmo Chrome) ----
    function executarBuscaAutomaticaNPU() {
        const hash = window.location.hash;
        if (!hash || !hash.startsWith("#npu=")) return;
        const npu = hash.replace("#npu=", "").trim();
        if (!npu) return;
        setTimeout(() => expandirFiltrosEBuscar(npu), 1500);
    }
    
    if (window.location.hash.startsWith("#npu=")) {
        if (document.readyState === "complete") {
            setTimeout(executarBuscaAutomaticaNPU, 1500);
        } else {
            window.addEventListener('load', () => setTimeout(executarBuscaAutomaticaNPU, 2000));
        }
    }
    window.addEventListener('hashchange', executarBuscaAutomaticaNPU);

})();

