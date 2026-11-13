// ==UserScript==
// @name          Tontom-Simap - Gestores
// @namespace     simap-tjpe
// @version      1.9.1
// @description   Extensão para gestores: injeta tags de prioridade (P1-P9), tags de Saldo/INCON/SCGA nos NPUs, busca no menu, opção SCGA-Em desacordo com a IS, menu de observações padronizadas e botão flutuante Colar NPU e Buscar
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

    console.log("😸 [Tontom] Iniciando extensão Gestores v1.8.4...");

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
.tag-saldo { background:#059669 !important; color:#fff !important; }
.tag-incon { background:#d97706 !important; color:#fff !important; }
.tag-scga { background:#facc15 !important; color:#000 !important; }
`);

    const BANCO_PRIORIDADES = new Map();
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
    function identificarPrioridadeSCGA(textoCelula) {
        if (!textoCelula) return null;
        const textoNorm = " " + normalizarTextoPlanilha(textoCelula) + " ";
        const achado = PRIORIDADES_SCGA_NORMALIZADAS.find(item => textoNorm.includes(item.chave));
        return achado ? achado.tag : null;
    }

    // Detecta o marcador [SCGA] (com ou sem colchetes) no texto da célula
    function temTagSCGA(textoCelula) {
        if (!textoCelula) return false;
        return /(^|[^a-z0-9])scga([^a-z0-9]|$)/i.test(String(textoCelula));
    }

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
                e.stopPropagation();
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

        const listaInicial = (opcoesObservacoesDinamicas && opcoesObservacoesDinamicas.length > 0)
            ? opcoesObservacoesDinamicas
            : opcoesPadrao;

        let opcoesMenu = [];

        function popularSelect(lista) {
            opcoesMenu = [...lista];
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

        const buscaObs = criarBuscaParaSelect(select, 'Buscar observação... (ex: SISC)');
        popularSelect(listaInicial);

        callbackAtualizarMenuObservacoes = function() {
            if (document.getElementById('containerMenuTontom') && opcoesObservacoesDinamicas) {
                popularSelect(opcoesObservacoesDinamicas);
            }
        };

        container.appendChild(buscaObs.elemento);
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
            }, true);
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
            divScga.style.display = 'none';
            selectScga.value = '';
            buscaScga.limpar();
            divScgaOutros.style.display = 'none';
            inputScgaOutros.value = '';
        }

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
        const clean = String(textoCelula).trim();
        
        let m = clean.match(/^\s*(\d+(?:[.,]\d+)?)/);
        if (m) {
            const valorStr = m[1].replace(',', '.');
            const base = parseInt(valorStr, 10);
            if (base >= 1 && base <= 11) return valorStr;
        }
        
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
        BANCO_SCGA.clear();
        BANCO_PRIO_DESC.clear();

        dados.forEach(row => {
            const npuBruto = row[idxNPU >= 0 ? idxNPU : 0];
            const npuChave = limparNPU(npuBruto);
            if (npuChave.length < 8) return;
            const chaveCurta = npuChave.substring(0, 8);

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
                    if (i === idxNPU || i === idxData) continue;
                    const p = extrairPrioridade(row[i]);
                    if (p) prioridadeIdentificada = p;
                    const tagEsp = extrairTagEspecial(row[i]);
                    if (tagEsp) tagEspecialIdentificada = tagEsp;
                    const descScga = identificarPrioridadeSCGA(row[i]);
                    if (descScga) descScgaIdentificada = descScga;
                    if (temTagSCGA(row[i]) || descScga) scgaIdentificada = true;
                }
            }
            const dataStr = idxData >= 0 ? row[idxData] : null;
            BANCO_PRIORIDADES.set(chaveCurta, {
                prioridade: prioridadeIdentificada,
                tagEspecial: tagEspecialIdentificada,
                data: dataStr,
                scga: scgaIdentificada,
                descScga: descScgaIdentificada
            });
            if (scgaIdentificada) BANCO_SCGA.add(chaveCurta);
            if (descScgaIdentificada) BANCO_PRIO_DESC.set(chaveCurta, descScgaIdentificada);
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

    function processarObservacoesPlanilha(matriz) {
        if (!matriz || matriz.length === 0) return null;

        let idxAtivo = -1;
        let idxMenu = -1;
        let idxPrefixo = -1;
        let idxTipo = -1;
        let idxRotulo = -1;
        let idxSubmenu = -1;

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
                                    const tagEspecial = typeof p === 'object' ? p.tagEspecial : null;
                                    const basePrio = parseInt(pValue, 10) || 9;
                                    const tag = document.createElement("span");
                                    tag.className = `tag-prioridade prio-p${basePrio}`;
                                    tag.textContent = `P${pValue}`;
                                    tag.title = `Prioridade Nível P${pValue}`;
                                    el.appendChild(tag);

                                    if (tagEspecial) {
                                        const tagEspNode = document.createElement("span");
                                        const classeTipo = tagEspecial.startsWith("Saldo") ? "tag-saldo" : "tag-incon";
                                        tagEspNode.className = `tag-prioridade ${classeTipo}`;
                                        tagEspNode.textContent = tagEspecial;
                                        tagEspNode.title = tagEspecial;
                                        el.appendChild(tagEspNode);
                                    }

                                    // Tag amarela SCGA, quando a célula da planilha traz [SCGA] ou prioridade SCGA
                                    if (BANCO_SCGA.has(chaveCurta) || (typeof p === 'object' && p.scga)) {
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

    // Inicialização
    mostrarAvisoCarregamento();
    carregarDadosPlanilha();
    carregarObservacoesPlanilha();

    // Atualiza observações periodicamente a cada 5 minutos
    setInterval(() => {
        carregarObservacoesPlanilha();
    }, 5 * 60 * 1000);

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
