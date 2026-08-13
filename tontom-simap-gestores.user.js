// ==UserScript==
// @name          Tontom-Simap - Gestores
// @namespace     simap-tjpe
// @version      1.7.2
// @description   Extensão para gestores: injeta tags de prioridade (P1-P9) nos NPUs, exibe o menu flutuante de observações padronizadas e o botão flutuante Colar NPU e Buscar.
// @match         https://simap.svc.tjpe.jus.br/*
// @match         https://*.tjpe.jus.br/*
// @match         https://*.pje.cloud.tjpe.jus.br/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      docs.google.com
// @run-at        document-end
// @downloadURL https://update.greasyfork.org/scripts/580997/Tontom-Simap%20-%20Gestores.user.js
// @updateURL https://update.greasyfork.org/scripts/580997/Tontom-Simap%20-%20Gestores.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const isPJe = window.location.hostname.includes("pje");
    const URL_PLANILHA = "https://docs.google.com/spreadsheets/d/1RFS3XkGQ7Ga1NqCMXJmqYGcR-JBCXtYB7r51quVb0yE/edit?gid=1744875210";

    console.log("😸 [Tontom] Iniciando extensão Gestores v1.7.2...");

    GM_addStyle(`
@media print {
    #tontomBtnColaNPU, #containerMenuTontom, #tontomLogVisual, .tag-prioridade {
        display: none !important;
    }
}
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

    // Cria um pequeno indicador visual de que a extensão está carregada (Apenas no SIMAP)
    function mostrarAvisoCarregamento() {
        if (isPJe) return;
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
        if (isPJe) return;
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
    // PARTE 2: BOTÃO FLUTUANTE "COLAR NPU E BUSCAR" (APENAS SIMAP)
    // ==========================================

    function mostrarLogVisual(msg, cor = '#1a73e8') {
        if (isPJe) return;
        let box = document.getElementById('tontomLogVisual');
        if (!box) {
            box = document.createElement('div');
            box.id = 'tontomLogVisual';
            box.style.cssText = `
                position: fixed; top: 80px; right: 20px;
                background: rgba(0,0,0,0.85); color: #fff;
                padding: 15px 20px; border-radius: 8px;
                font-family: sans-serif; font-size: 13px;
                z-index: 100000; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                max-width: 300px; border-left: 5px solid ${cor};
                transition: all 0.3s ease;
            `;
            document.body.appendChild(box);
        }
        box.style.borderLeftColor = cor;
        box.innerHTML = `<div style="font-weight:bold; margin-bottom:5px; color:${cor}">😸 Tontom Status:</div><div>${msg}</div>`;
        
        if (cor !== '#1a73e8' && cor !== '#e65100') {
            setTimeout(() => {
                if (box && box.parentNode) box.remove();
            }, 5000);
        }
    }

    function localizarInputNPU() {
        const inputs = Array.from(document.querySelectorAll('input'));
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
        
        const labels = Array.from(document.querySelectorAll('label, mat-label, span, mat-placeholder, p'));
        for (const lbl of labels) {
            const text = String(lbl.innerText || lbl.textContent || "").trim().toUpperCase();
            if (text === "NPU" || text === "NPU:" || text === "PROCESSO" || text === "PROCESSO:" || text === "Nº PROCESSO" || text === "N° DO PROCESSO") {
                const forAttr = lbl.getAttribute('for');
                if (forAttr) {
                    const inp = document.getElementById(forAttr);
                    if (inp && (inp.offsetParent !== null || inp.offsetWidth > 0)) return inp;
                }
                
                let container = lbl.parentElement;
                for (let d = 0; d < 5; d++) {
                    if (!container || container.tagName === 'BODY') break;
                    const found = container.querySelector('input:not([type="hidden"])');
                    if (found && (found.offsetParent !== null || found.offsetWidth > 0)) return found;
                    container = container.parentElement;
                }
            }
        }

        const visibleInputs = inputs.filter(inp => inp.type !== "hidden" && (inp.offsetParent !== null || inp.offsetWidth > 0));
        if (visibleInputs.length === 1) return visibleInputs[0];
        return null;
    }

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

    function expandirFiltrosEBuscar(npu) {
        mostrarLogVisual("Iniciando busca automática do NPU " + npu, "#1a73e8");
        let fase1Count = 0;
        let filtroClicado = false;
        
        const fase1 = setInterval(() => {
            fase1Count++;
            if (fase1Count > 33) { 
                clearInterval(fase1); 
                mostrarLogVisual("Tempo esgotado ao buscar campo de NPU.", "#e53935");
                return; 
            }
            
            const inputExistente = localizarInputNPU();
            if (inputExistente) {
                clearInterval(fase1);
                mostrarLogVisual("Input NPU localizado! Preenchendo dados...", "#1a73e8");
                preencherInputAngular(inputExistente, npu);
                setTimeout(() => clicarPesquisar(inputExistente), 600);
                return;
            }
            
            if (!filtroClicado) {
                mostrarLogVisual("Painel de filtros fechado. Tentando abrir...", "#f57c00");
                const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], .mat-focus-indicator, .btn'));
                const btnFiltro = clickables.find(el => {
                    const text = String(el.innerText || el.textContent || "").trim().toLowerCase();
                    return text.includes("filtro");
                });
                
                if (btnFiltro) {
                    filtroClicado = true;
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
                    if (alvo !== btnFiltro) alvo.click();
                    else btnFiltro.click();
                    mostrarLogVisual("Botão Filtros clicado! Aguardando renderização...", "#f57c00");
                }
            }
        }, 300);
    }

    function clicarPesquisar(inputRef) {
        mostrarLogVisual("Preenchido! Procurando botão Pesquisar...", "#1a73e8");
        let count = 0;
        
        const interval = setInterval(() => {
            count++;
            if (count > 15) {
                clearInterval(interval);
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

    function criarBotaoColaNPU() {
        if (isPJe) return;
        if (document.getElementById('tontomBtnColaNPU')) return;
        
        const btn = document.createElement('div');
        btn.id = 'tontomBtnColaNPU';
        btn.innerHTML = '📋 Colar NPU e Buscar';
        btn.title = 'Cole o NPU da área de transferência, preencha automaticamente e busque no SIMAP (Arraste para mover)';
        btn.style.cssText = `
            position: fixed; bottom: 80px; right: 20px;
            background: linear-gradient(135deg, #1a73e8, #0d47a1);
            color: #fff; padding: 12px 20px; border-radius: 30px;
            cursor: pointer; font-size: 14px; font-weight: bold;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 99999;
            user-select: none; transition: transform 0.2s ease, box-shadow 0.2s ease;
            display: flex; align-items: center; gap: 6px; font-family: sans-serif;
        `;
        
        const salvoTop = localStorage.getItem('tontomBtnColaNPU_top');
        const salvoLeft = localStorage.getItem('tontomBtnColaNPU_left');
        if (salvoTop && salvoLeft) {
            btn.style.bottom = 'auto'; btn.style.right = 'auto';
            btn.style.top = salvoTop; btn.style.left = salvoLeft;
        }
        
        btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)'; };
        btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)'; };
        
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        let arrastou = false;
        let startX = 0, startY = 0;
        
        btn.onmousedown = (e) => {
            if (e.button !== 0) return;
            arrastou = false;
            startX = e.clientX; startY = e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
            btn.style.cursor = 'grabbing';
        };
        
        function elementDrag(e) {
            e.preventDefault();
            if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) {
                arrastou = true;
            }
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            btn.style.bottom = 'auto'; btn.style.right = 'auto';
            btn.style.top = (btn.offsetTop - pos2) + "px";
            btn.style.left = (btn.offsetLeft - pos1) + "px";
        }
        
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
            btn.style.cursor = 'pointer';
            localStorage.setItem('tontomBtnColaNPU_top', btn.style.top);
            localStorage.setItem('tontomBtnColaNPU_left', btn.style.left);
        }
        
        btn.onclick = async (e) => {
            if (arrastou) { arrastou = false; return; }
            try {
                const textoClipboard = await navigator.clipboard.readText();
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
                
                btn.innerHTML = '⏳ Buscando...';
                btn.style.background = 'linear-gradient(135deg, #43a047, #2e7d32)';
                expandirFiltrosEBuscar(npuLimpo);
                
                setTimeout(() => {
                    btn.innerHTML = '📋 Colar NPU e Buscar';
                    btn.style.background = 'linear-gradient(135deg, #1a73e8, #0d47a1)';
                }, 3000);
            } catch(err) {
                mostrarLogVisual("Erro ao ler área de transferência. Clique na página para dar foco antes de clicar.", "#f57c00");
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

    function executarBuscaAutomaticaNPU() {
        if (isPJe) return;
        const hash = window.location.hash;
        if (!hash || !hash.startsWith("#npu=")) return;
        const npu = hash.replace("#npu=", "").trim();
        if (!npu) return;
        setTimeout(() => expandirFiltrosEBuscar(npu), 1500);
    }

    // ==========================================
    // PARTE 3: LEITURA E INJEÇÃO DAS TAGS DE PRIORIDADE
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
            const chaveCurta = npuChave.substring(0, 8);

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
                console.log("😸 [Tontom] Fetch direto falhou. Tentando GM_xmlhttpRequest...", err);
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
            });
    }

    function aplicarTagsNaTela() {
        if (BANCO_PRIORIDADES.size === 0) return;
        const regexNPU = /\b\d{7}[-.]?\d{1,2}([-.]?\d{4}[-.]?\d[-.]?\d{2}[-.]?\d{4})?\b/g;
        const elementos = document.querySelectorAll("td, span, a, div.ui-outputpanel");
        elementos.forEach(el => {
            if (el.closest('#containerMenuTontom') || el.closest('#tontomBtnColaNPU')) return;
            // TRAVA DE SEGURANÇA CRÍTICA PARA PJE: Nunca injetar tags em editores de texto ou telas de visualização de documentos HTML do PJe
            if (el.closest('[contenteditable="true"], .cke_editor, iframe, #documentoHTML, .documento-html, .seam-doc, form[name="documentoForm"], .ui-dialog-content')) return;

            if (el.querySelector(".tag-prioridade") || el.classList.contains("tag-prioridade")) return;
            if (el.childNodes.length > 0) {
                for (let node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE && regexNPU.test(node.nodeValue)) {
                        const correspondencias = node.nodeValue.match(regexNPU);
                        if (correspondencias) {
                            correspondencias.forEach(npuMatch => {
                                const chave = limparNPU(npuMatch);
                                if (chave.length < 8) return;
                                const chaveCurta = chave.substring(0, 8);

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

    if (!isPJe) {
        criarBotaoColaNPU();
        if (window.location.hash.startsWith("#npu=")) {
            if (document.readyState === "complete") {
                setTimeout(executarBuscaAutomaticaNPU, 1500);
            } else {
                window.addEventListener('load', () => setTimeout(executarBuscaAutomaticaNPU, 2000));
            }
        }
        window.addEventListener('hashchange', executarBuscaAutomaticaNPU);
    }

    const observer = new MutationObserver((mutations) => {
        const apenasNossaObs = mutations.every(m => m.target.closest('#containerMenuTontom') || m.target.closest('#tontomBtnColaNPU'));
        if (apenasNossaObs) return;

        aplicarTagsNaTela();
        if (!isPJe) {
            injetarMenuFlutuante();
            criarBotaoColaNPU();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    setInterval(() => {
        aplicarTagsNaTela();
        if (!isPJe) {
            injetarMenuFlutuante();
            criarBotaoColaNPU();
        }
    }, 1500);

})();
