const STORAGE_REPORTE = "aire_para_reportar_v6";
const STORAGE_ULTIMA_TABLA = "aire_ultima_tabla_v6";
const STORAGE_TEXTO_RAW = "aire_texto_raw_v6";
 
const ANOMALIAS_VALIDAS = [
    "",
    "IP y Puerto No responden",
    "Puerto no responde",
    "IP no responde",
    "Medidor no responde"
];
 
let reporteMap = new Map();
let ultimasFilasCalculadas = [];
let filtrosActivos = new Set(["todos"]);
let ordenActual = { campo: null, direccion: "asc" };
let _accionConfirmacionPendiente = null;
 
window.addEventListener("DOMContentLoaded", () => {
    cargarEstadoGuardado();
    actualizarIndicadoresOrden();
});
 
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const modal = document.getElementById("modalConfirmacion");
        if (modal && !modal.hidden) {
            cerrarModalConfirmacion();
        }
    }
});
 
function normalizarId(id) {
    return String(id ?? "").trim();
}
 
function mostrarAviso(mensaje) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = mensaje;
    toast.classList.add("show");
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2400);
}
 
function solicitarConfirmacion({ titulo, mensaje, textoConfirmar = "Confirmar", onConfirm }) {
    const modal = document.getElementById("modalConfirmacion");
    const elTitulo = document.getElementById("modalTitulo");
    const elMensaje = document.getElementById("modalMensaje");
    const btnConfirmar = document.getElementById("btnConfirmarModal");
    const btnCancelar = document.getElementById("btnCancelarModal");
 
    if (!modal || !elTitulo || !elMensaje || !btnConfirmar || !btnCancelar) {
        if (window.confirm(mensaje) && typeof onConfirm === "function") {
            onConfirm();
        }
        return;
    }
 
    _accionConfirmacionPendiente = onConfirm;
    elTitulo.textContent = titulo || "Confirmar acción";
    elMensaje.textContent = mensaje || "¿Deseas continuar?";
    btnConfirmar.textContent = textoConfirmar;
 
    btnConfirmar.onclick = () => {
        const fn = _accionConfirmacionPendiente;
        cerrarModalConfirmacion();
        if (typeof fn === "function") fn();
    };
 
    btnCancelar.onclick = () => {
        cerrarModalConfirmacion();
    };
 
    modal.onclick = (e) => {
        if (e.target === modal) {
            cerrarModalConfirmacion();
        }
    };
 
    modal.hidden = false;
    requestAnimationFrame(() => {
        modal.classList.add("show");
    });
    btnConfirmar.focus();
}
 
function cerrarModalConfirmacion() {
    const modal = document.getElementById("modalConfirmacion");
    if (!modal) return;
    modal.classList.remove("show");
    _accionConfirmacionPendiente = null;
    setTimeout(() => {
        if (!modal.classList.contains("show")) {
            modal.hidden = true;
        }
    }, 180);
}
 
function clasePorAnomalia(anomalia) {
    switch (anomalia) {
        case "IP y Puerto No responden":
            return "anom-ip-puerto";
        case "Puerto no responde":
            return "anom-puerto";
        case "IP no responde":
            return "anom-ip";
        case "Medidor no responde":
            return "anom-medidor";
        default:
            return "";
    }
}
 
function claseFilaPorAnomalia(anomalia) {
    const base = clasePorAnomalia(anomalia);
    return base ? `fila-${base}` : "";
}
 
function cargarEstadoGuardado() {
    try {
        const textoGuardado = localStorage.getItem(STORAGE_TEXTO_RAW);
        const txtEntrada = document.getElementById("txtEntrada");
        if (textoGuardado && txtEntrada && !txtEntrada.value.trim()) {
            txtEntrada.value = textoGuardado;
        }
 
        const guardados = JSON.parse(localStorage.getItem(STORAGE_REPORTE) || "[]");
        reporteMap = new Map(
            guardados
                .filter(item => item && normalizarId(item.medidor))
                .map(item => [normalizarId(item.medidor), { ...item, medidor: normalizarId(item.medidor) }])
        );
 
        const ultimaTabla = JSON.parse(localStorage.getItem(STORAGE_ULTIMA_TABLA) || "[]");
        if (Array.isArray(ultimaTabla) && ultimaTabla.length > 0) {
            ultimasFilasCalculadas = ultimaTabla.map((f, i) => ({
                ...f,
                deviceId: normalizarId(f.deviceId),
                accountNo: f.accountNo || "",
                ip: f.ip || "",
                phone: f.phone || "",
                principalRespaldo: f.principalRespaldo || "Principal",
                anomalia: ANOMALIAS_VALIDAS.includes(f.anomalia) ? f.anomalia : "",
                _idxOriginal: f._idxOriginal ?? i + 1
            }));
            aplicarFiltrosYOrden();
            actualizarContadorFilas(ultimasFilasCalculadas);
        }
    } catch (err) {
        console.error("Error cargando estado:", err);
    }
    renderizarParaReportar();
}
 
function guardarParaReportar() {
    localStorage.setItem(STORAGE_REPORTE, JSON.stringify(Array.from(reporteMap.values())));
}
 
function actualizarContadorFilas(filas) {
    const el = document.getElementById("contadorFilas");
    if (!el) return;
    const alDia = filas.filter(f => f.alDia).length;
    el.textContent = `${filas.length} filas (${alDia} al día)`;
}
 
function reconstruirFilasDesdeTexto(raw) {
    const lineas = raw.split(/\r?\n/);
    const filasReconstruidas = [];
    let filaActual = "";
 
    for (const linea of lineas) {
        const limpia = linea.replace(/[\u00a0\u202f]/g, " ").trim();
        if (!limpia) continue;
 
        const primerToken = limpia.split("\t")[0].trim();
        const esInicioFila = /^\d{3,}$/.test(primerToken) || /^device\s*id$/i.test(primerToken);
 
        if (esInicioFila) {
            if (filaActual) {
                filasReconstruidas.push(filaActual);
            }
            filaActual = linea.replace(/[\u00a0\u202f]/g, " ");
        } else if (filaActual) {
            filaActual += " " + limpia;
        }
    }
 
    if (filaActual) {
        filasReconstruidas.push(filaActual);
    }
 
    return filasReconstruidas;
}
 
function resolverIndicesColumnas(filasReconstruidas) {
    const defaults = {
        deviceId: 0,
        accountNo: 1,
        descripcion: 3,
        lastLoadProfile: 4,
        ipPhone: 5,
        ip: -1,
        phone: -1,
        deviceType: 6,
        state: 7,
        city: 8,
        isBackup: -1
    };
 
    for (const fila of filasReconstruidas) {
        const cols = fila.split("\t").map(c => c.replace(/[\u00a0\u202f]/g, " ").trim().toLowerCase());
        if (cols.some(c => c === "device id")) {
            const idx = { ...defaults };
            cols.forEach((h, i) => {
                if (h === "device id") idx.deviceId = i;
                else if (h.includes("account")) idx.accountNo = i;
                else if (h === "description" || h === "name") idx.descripcion = i;
                else if (h.includes("last load profile")) idx.lastLoadProfile = i;
                else if (h === "ip") idx.ip = i;
                else if (h === "phone") idx.phone = i;
                else if (h.includes("phone") && h.includes("ip")) idx.ipPhone = i;
                else if (h.includes("device type")) idx.deviceType = i;
                else if (h === "state") idx.state = i;
                else if (h === "city") idx.city = i;
                else if (h.includes("backup")) idx.isBackup = i;
            });
            return idx;
        }
    }
    return defaults;
}
 
function interpretarBackup(cols, idx) {
    let rawBackup = "";
    if (idx.isBackup >= 0 && cols[idx.isBackup] !== undefined) {
        rawBackup = cols[idx.isBackup].trim().toLowerCase();
    } else {
        for (let i = 8; i < cols.length; i++) {
            const v = cols[i].trim().toLowerCase();
            if (v === "0" || v === "1") {
                rawBackup = v;
                break;
            }
        }
    }
 
    if (rawBackup === "1" || rawBackup === "true" || rawBackup === "respaldo" || rawBackup === "backup") {
        return "Respaldo";
    }
    return "Principal";
}
 
function extraerIpYPhone(cols, idx) {
    let ip = "";
    let phone = "";
 
    if (idx.ip >= 0 && cols[idx.ip]) {
        ip = cols[idx.ip].trim();
    }
    if (idx.phone >= 0 && cols[idx.phone]) {
        phone = cols[idx.phone].trim();
    }
 
    const valorIpPhone = cols[idx.ipPhone] ? cols[idx.ipPhone].trim() : "";
    if (valorIpPhone) {
        if (valorIpPhone.includes(",")) {
            const [parteIp, partePhone] = valorIpPhone.split(",");
            ip = ip || (parteIp || "").trim();
            phone = phone || (partePhone || "").trim();
        } else {
            const partes = valorIpPhone.split(/[;/|]+|\s+/).map(p => p.trim()).filter(Boolean);
            for (const p of partes) {
                if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(p)) {
                    ip = ip || p;
                } else if (/^\+?\d{5,}$/.test(p)) {
                    phone = phone || p;
                } else if (!ip) {
                    ip = p;
                } else if (!phone) {
                    phone = p;
                }
            }
        }
    }
 
    return { ip, phone };
}
 
function parsearFechaColombiana(fechaStr) {
    if (!fechaStr) return null;
 
    const limpia = String(fechaStr)
        .replace(/[\u00a0\u202f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
 
    const matchFecha = limpia.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (!matchFecha) return null;
 
    const dia = parseInt(matchFecha[1], 10);
    const mes = parseInt(matchFecha[2], 10) - 1;
    const anio = parseInt(matchFecha[3], 10);
 
    const resto = limpia.slice(matchFecha.index + matchFecha[0].length).trim();
    const matchHora = resto.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
 
    let hora = matchHora ? parseInt(matchHora[1], 10) : 0;
    const minuto = matchHora ? parseInt(matchHora[2], 10) : 0;
    const segundo = matchHora && matchHora[3] ? parseInt(matchHora[3], 10) : 0;
 
    const sinEspaciosPuntos = resto.toLowerCase().replace(/[\s.]+/g, "");
    const esPM = sinEspaciosPuntos.includes("pm");
    const esAM = sinEspaciosPuntos.includes("am");
 
    if (esPM && hora < 12) {
        hora += 12;
    } else if (esAM && hora === 12) {
        hora = 0;
    }
 
    const fecha = new Date(anio, mes, dia, hora, minuto, segundo);
    return isNaN(fecha.getTime()) ? null : fecha;
}
 
function buscarFechaEnFila(cols, idx) {
    const candidatos = [cols[idx.lastLoadProfile], cols[4], cols[5], cols[3], cols[6]];
    for (const cand of candidatos) {
        if (!cand) continue;
        const parsed = parsearFechaColombiana(cand);
        if (parsed) {
            return { texto: cand.replace(/[\u00a0\u202f]/g, " ").trim(), fecha: parsed };
        }
    }
    return { texto: (cols[idx.lastLoadProfile] || "").trim() || "Sin fecha", fecha: null };
}
 
function formatearFechaCO(fecha) {
    const pad = n => String(n).padStart(2, "0");
    const dia = pad(fecha.getDate());
    const mes = pad(fecha.getMonth() + 1);
    const anio = fecha.getFullYear();
 
    const horas24 = fecha.getHours();
    const minutos = pad(fecha.getMinutes());
    const segundos = pad(fecha.getSeconds());
    const sufijo = horas24 >= 12 ? "p. m." : "a. m.";
    let horas12 = horas24 % 12;
    if (horas12 === 0) horas12 = 12;
 
    return `${dia}/${mes}/${anio} ${pad(horas12)}:${minutos}:${segundos} ${sufijo}`;
}
 
function extraerDesfase(descripcion) {
    if (!descripcion) return "Sin desfase";
    const texto = String(descripcion).replace(/[\u00a0\u202f]/g, " ");
    const match = texto.match(/\(?\s*DESFASE\s+([0-9]+\s*H(?:\s*[_-]?\s*[0-9]+\s*MIN)?|[0-9]+\s*MIN)\s*\)?/i);
    if (!match || !match[1]) return "Sin desfase";
    return match[1].replace(/\s+/g, " ").trim().toUpperCase();
}
 
function aplicarDesfase(fechaObj, fechaOriginalStr, desfaseTexto) {
    const originalLimpio = fechaOriginalStr
        ? String(fechaOriginalStr).replace(/[\u00a0\u202f]/g, " ").trim()
        : "Sin fecha";
 
    if (!fechaObj) {
        return {
            original: originalLimpio || "Sin fecha",
            corregida: originalLimpio || "Sin fecha",
            fechaCorregidaObj: null
        };
    }
 
    const copia = new Date(fechaObj.getTime());
 
    if (desfaseTexto && desfaseTexto !== "Sin desfase") {
        const matchH = desfaseTexto.match(/(\d+)\s*H/i);
        const matchM = desfaseTexto.match(/(\d+)\s*MIN/i);
 
        const horas = matchH ? parseInt(matchH[1], 10) : 0;
        const minutos = matchM ? parseInt(matchM[1], 10) : 0;
 
        copia.setHours(copia.getHours() + horas);
        copia.setMinutes(copia.getMinutes() + minutos);
    }
 
    return {
        original: originalLimpio,
        corregida: formatearFechaCO(copia),
        fechaCorregidaObj: copia
    };
}
 
function describirAntiguedad(fechaCorregidaStr) {
    const fechaEval = parsearFechaColombiana(fechaCorregidaStr);
    if (!fechaEval) {
        return { texto: "No comunica", dias: 999999, claseFila: "fila-critico", claseBadge: "badge-critico", alDia: false };
    }
 
    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
    const inicioFecha = new Date(fechaEval.getFullYear(), fechaEval.getMonth(), fechaEval.getDate()).getTime();
 
    const dias = Math.floor((inicioHoy - inicioFecha) / (1000 * 60 * 60 * 24));
 
    if (dias <= 0) {
        return { texto: "Al día", dias: 0, claseFila: "fila-aldia", claseBadge: "badge-aldia", alDia: true };
    }
    if (dias === 1) {
        return { texto: "Ayer", dias: 1, claseFila: "fila-ayer", claseBadge: "badge-ayer", alDia: false };
    }
    if (dias === 2) {
        return { texto: "Hace 2 días", dias: 2, claseFila: "fila-2dias", claseBadge: "badge-2dias", alDia: false };
    }
    if (dias < 7) {
        return { texto: `Hace ${dias} días`, dias, claseFila: "fila-critico", claseBadge: "badge-critico", alDia: false };
    }
    if (dias < 30) {
        const sem = Math.floor(dias / 7);
        const rem = dias % 7;
        return {
            texto: rem > 0 ? `Hace ${sem} sem y ${rem} d` : `Hace ${sem} ${sem === 1 ? "semana" : "semanas"}`,
            dias,
            claseFila: "fila-critico",
            claseBadge: "badge-critico",
            alDia: false
        };
    }
    if (dias < 365) {
        const meses = Math.floor(dias / 30.4375);
        return {
            texto: `Hace ${meses} ${meses === 1 ? "mes" : "meses"}`,
            dias,
            claseFila: "fila-critico",
            claseBadge: "badge-critico",
            alDia: false
        };
    }
 
    const anios = Math.floor(dias / 365.25);
    const mesesRest = Math.floor((dias % 365.25) / 30.4375);
    return {
        texto: mesesRest > 0 ? `Hace ${anios}a ${mesesRest}m` : `Hace ${anios} ${anios === 1 ? "año" : "años"}`,
        dias,
        claseFila: "fila-critico",
        claseBadge: "badge-critico",
        alDia: false
    };
}
 
function procesarDatos() {
    const raw = document.getElementById("txtEntrada").value;
    if (!raw.trim()) {
        mostrarAviso("Pega primero los datos del sistema.");
        return;
    }
 
    localStorage.setItem(STORAGE_TEXTO_RAW, raw);
 
    const lineas = reconstruirFilasDesdeTexto(raw);
    const idxCols = resolverIndicesColumnas(lineas);
    const filasProcesadas = [];
 
    for (const linea of lineas) {
        const cols = linea.split("\t").map(c => c.replace(/[\u00a0\u202f]/g, " ").trim());
        if (cols.length < 2) continue;
 
        const deviceId = normalizarId(cols[idxCols.deviceId] || "");
        if (!deviceId || /^device\s*id$/i.test(deviceId)) continue;
 
        const accountNo = cols[idxCols.accountNo] || "";
        const descripcion = cols[idxCols.descripcion] || cols[2] || "";
        const hallazgoFecha = buscarFechaEnFila(cols, idxCols);
        const { ip, phone } = extraerIpYPhone(cols, idxCols);
        const deviceType = cols[idxCols.deviceType] || "";
        const state = cols[idxCols.state] || "";
        const city = cols[idxCols.city] || "";
        const principalRespaldo = interpretarBackup(cols, idxCols);
 
        const desfase = extraerDesfase(descripcion);
        const fechas = aplicarDesfase(hallazgoFecha.fecha, hallazgoFecha.texto, desfase);
        const estado = describirAntiguedad(fechas.corregida);
 
        const existenteEnReporte = reporteMap.get(deviceId);
        const anomaliaInicial = existenteEnReporte ? existenteEnReporte.anomalia || "" : "";
 
        const filaObj = {
            _idxOriginal: filasProcesadas.length + 1,
            deviceId,
            accountNo,
            descripcion,
            desfase,
            tieneDesfase: desfase !== "Sin desfase",
            fechaOriginal: fechas.original,
            fechaCorregida: fechas.corregida,
            tsOriginal: hallazgoFecha.fecha ? hallazgoFecha.fecha.getTime() : 0,
            tsCorregida: fechas.fechaCorregidaObj ? fechas.fechaCorregidaObj.getTime() : 0,
            estadoTexto: estado.texto,
            diasAtraso: estado.dias,
            claseFila: estado.claseFila,
            claseBadge: estado.claseBadge,
            alDia: estado.alDia,
            ip,
            phone,
            deviceType,
            state,
            city,
            principalRespaldo,
            anomalia: anomaliaInicial
        };

        filasProcesadas.push(filaObj);
 
        if (existenteEnReporte) {
            reporteMap.set(deviceId, construirObjetoReporte(filaObj, anomaliaInicial));
        }
    }
 
    ultimasFilasCalculadas = filasProcesadas;
    localStorage.setItem(STORAGE_ULTIMA_TABLA, JSON.stringify(filasProcesadas));
    guardarParaReportar();
 
    actualizarContadorFilas(filasProcesadas);
    aplicarFiltrosYOrden();
    renderizarParaReportar();
    mostrarAviso(`Procesadas ${filasProcesadas.length} filas.`);
}
 
function construirObjetoReporte(fila, anomalia) {
    return {
        codigo: fila.accountNo || "",
        nombre: fila.descripcion || "",
        medidor: normalizarId(fila.deviceId || ""),
        tipo: fila.deviceType || "",
        delegacion: fila.state || "",
        localidad: fila.city || "",
        principalRespaldo: fila.principalRespaldo || "Principal",
        lastRead: fila.fechaCorregida || fila.fechaOriginal || "",
        ip: fila.ip || "",
        phone: fila.phone || "",
        anomalia: anomalia || ""
    };
}
 
function enviarAReporte(idxOriginal) {
    const fila = ultimasFilasCalculadas.find(f => f._idxOriginal === idxOriginal);
    if (!fila) return;
 
    const idNorm = normalizarId(fila.deviceId);
    reporteMap.set(idNorm, construirObjetoReporte(fila, fila.anomalia || ""));
    guardarParaReportar();
    renderizarParaReportar();
    aplicarFiltrosYOrden();
    mostrarAviso(`Medidor ${idNorm} marcado como En reporte.`);
}
 
function quitarDeReporte(medidor) {
    const idNorm = normalizarId(medidor);
    const item = reporteMap.get(idNorm);
    const etiquetaCodigo = item && item.codigo ? String(item.codigo).trim() : idNorm;
    const nombreMedidor = item && item.nombre ? String(item.nombre).trim() : "Sin nombre";
 
    solicitarConfirmacion({
        titulo: "Quitar de reporte",
        mensaje: `¿Desea quitar ${etiquetaCodigo} "${nombreMedidor}" de reporte?`,
        textoConfirmar: "Sí, quitar",
        onConfirm: () => {
            reporteMap.delete(idNorm);
            guardarParaReportar();
            renderizarParaReportar();
            aplicarFiltrosYOrden();
            mostrarAviso(`Medidor ${idNorm} quitado de Para reportar.`);
        }
    });
}
 
function vaciarParaReportar() {
    if (reporteMap.size === 0) {
        mostrarAviso("La lista Para reportar ya está vacía.");
        return;
    }
 
    solicitarConfirmacion({
        titulo: "Vaciar Para reportar",
        mensaje: `¿Deseas vaciar todos los ${reporteMap.size} registros de la lista Para reportar?`,
        textoConfirmar: "Sí, vaciar",
        onConfirm: () => {
            reporteMap.clear();
            guardarParaReportar();
            renderizarParaReportar();
            aplicarFiltrosYOrden();
            mostrarAviso("Lista Para reportar vaciada.");
        }
    });
}
 
function cambiarAnomaliaFila(idxOriginal, nuevaAnomalia) {
    if (!ANOMALIAS_VALIDAS.includes(nuevaAnomalia)) return;
 
    const fila = ultimasFilasCalculadas.find(f => f._idxOriginal === idxOriginal);
    if (!fila) return;
 
    fila.anomalia = nuevaAnomalia;
    localStorage.setItem(STORAGE_ULTIMA_TABLA, JSON.stringify(ultimasFilasCalculadas));
 
    const idNorm = normalizarId(fila.deviceId);
    if (reporteMap.has(idNorm)) {
        const item = reporteMap.get(idNorm);
        item.anomalia = nuevaAnomalia;
        reporteMap.set(idNorm, item);
        guardarParaReportar();
        renderizarParaReportar();
    }
 
    aplicarFiltrosYOrden();
    mostrarAviso(nuevaAnomalia ? `Anomalía: ${nuevaAnomalia}` : "Anomalía en blanco.");
}
 
function cambiarAnomaliaReporte(medidor, nuevaAnomalia) {
    if (!ANOMALIAS_VALIDAS.includes(nuevaAnomalia)) return;
    const idNorm = normalizarId(medidor);
    const item = reporteMap.get(idNorm);
    if (!item) return;
 
    item.anomalia = nuevaAnomalia;
    reporteMap.set(idNorm, item);
    guardarParaReportar();
 
    const filaEnTabla = ultimasFilasCalculadas.find(f => normalizarId(f.deviceId) === idNorm);
    if (filaEnTabla) {
        filaEnTabla.anomalia = nuevaAnomalia;
        localStorage.setItem(STORAGE_ULTIMA_TABLA, JSON.stringify(ultimasFilasCalculadas));
    }
 
    renderizarParaReportar();
    aplicarFiltrosYOrden();
    mostrarAviso(nuevaAnomalia ? `Anomalía: ${nuevaAnomalia}` : "Anomalía en blanco.");
}
 
function obtenerTerminosBusqueda() {
    const input = document.getElementById("filtroCodigos");
    if (!input) return [];
    return input.value
        .split(/[\s,;\t\r\n]+/)
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
}
 
function limpiarFiltroCodigos() {
    const input = document.getElementById("filtroCodigos");
    if (input) {
        input.value = "";
        aplicarFiltrosYOrden();
        mostrarAviso("Búsqueda por código/medidor limpiada.");
    }
}
 
function toggleFiltro(nombreFiltro) {
    if (nombreFiltro === "todos") {
        filtrosActivos = new Set(["todos"]);
    } else {
        filtrosActivos.delete("todos");
        if (filtrosActivos.has(nombreFiltro)) {
            filtrosActivos.delete(nombreFiltro);
        } else {
            filtrosActivos.add(nombreFiltro);
        }
        if (filtrosActivos.size === 0) {
            filtrosActivos.add("todos");
        }
    }
    sincronizarChips();
    aplicarFiltrosYOrden();
}
 
function limpiarFiltros() {
    filtrosActivos = new Set(["todos"]);
    ordenActual = { campo: null, direccion: "asc" };
    const input = document.getElementById("filtroCodigos");
    if (input) input.value = "";
    const selAnom = document.getElementById("filtroTipoAnomalia");
    if (selAnom) selAnom.value = "";
    sincronizarChips();
    actualizarIndicadoresOrden();
    aplicarFiltrosYOrden();
    mostrarAviso("Filtros y orden restablecidos.");
}
 
function sincronizarChips() {
    document.querySelectorAll(".chip[data-filtro]").forEach(btn => {
        const f = btn.getAttribute("data-filtro");
        btn.classList.toggle("active", filtrosActivos.has(f));
    });
}
 
function cumpleFiltros(fila) {
    const terminos = obtenerTerminosBusqueda();
    if (terminos.length > 0) {
        const medidor = String(fila.deviceId || "").toLowerCase();
        const account = String(fila.accountNo || "").toLowerCase();
        const ip = String(fila.ip || "").toLowerCase();
        const phone = String(fila.phone || "").toLowerCase();
        const coincideAlguno = terminos.some(
            t => medidor.includes(t) || account.includes(t) || ip.includes(t) || phone.includes(t)
        );
        if (!coincideAlguno) return false;
    }
 
    const tipoAnomSeleccionado = document.getElementById("filtroTipoAnomalia")?.value || "";
    if (tipoAnomSeleccionado && fila.anomalia !== tipoAnomSeleccionado) {
        return false;
    }
 
    if (filtrosActivos.has("todos") || filtrosActivos.size === 0) return true;
 
    for (const f of filtrosActivos) {
        if (f === "aldia" && fila.alDia) return true;
        if (f === "ayer" && fila.diasAtraso === 1) return true;
        if (f === "2dias" && fila.diasAtraso === 2) return true;
        if (f === "desfase" && fila.tieneDesfase) return true;
        if (f === "atrasados" && !fila.alDia) return true;
        if (f === "anomalias" && Boolean(fila.anomalia)) return true;
    }
    return false;
}
 
function ordenarPor(campo) {
    if (ordenActual.campo === campo) {
        ordenActual.direccion = ordenActual.direccion === "asc" ? "desc" : "asc";
    } else {
        ordenActual.campo = campo;
        ordenActual.direccion = "asc";
    }
    actualizarIndicadoresOrden();
    aplicarFiltrosYOrden();
}
 
function actualizarIndicadoresOrden() {
    document.querySelectorAll("th.sortable").forEach(th => {
        const campo = th.getAttribute("data-sort");
        th.classList.remove("sort-asc", "sort-desc");
        if (ordenActual.campo === campo) {
            th.classList.add(ordenActual.direccion === "asc" ? "sort-asc" : "sort-desc");
        }
    });
}
 
function obtenerFilasVisibles() {
    let lista = ultimasFilasCalculadas.filter(cumpleFiltros);
 
    if (ordenActual.campo) {
        const dir = ordenActual.direccion === "asc" ? 1 : -1;
        lista = [...lista].sort((a, b) => {
            switch (ordenActual.campo) {
                case "idx":
                    return (a._idxOriginal - b._idxOriginal) * dir;
                case "deviceId":
                    return ((Number(a.deviceId) || 0) - (Number(b.deviceId) || 0)) * dir || String(a.deviceId).localeCompare(String(b.deviceId)) * dir;
                case "accountNo":
                    return String(a.accountNo || "").localeCompare(String(b.accountNo || ""), "es", { numeric: true }) * dir;
                case "estado":
                    return (a.diasAtraso - b.diasAtraso) * dir;
                case "desfase":
                    return String(a.desfase).localeCompare(String(b.desfase), "es") * dir;
                case "original":
                    return (a.tsOriginal - b.tsOriginal) * dir;
                case "corregida":
                    return ((a.tsCorregida ?? a.tsOriginal) - (b.tsCorregida ?? b.tsOriginal)) * dir;
                default:
                    return String(a[ordenActual.campo] || "").localeCompare(String(b[ordenActual.campo] || ""), "es") * dir;
            }
        });
    }
 
    return lista;
}
 
function aplicarFiltrosYOrden() {
    const visibles = obtenerFilasVisibles();
    renderizarTabla(visibles);
}
 
function renderizarSelectorAnomalia(anomaliaActual, handlerJs) {
    const actual = anomaliaActual || "";
    const cls = clasePorAnomalia(actual);
    const opciones = ANOMALIAS_VALIDAS.map(op => {
        const selected = op === actual ? "selected" : "";
        return `<option value="${escaparHtml(op)}" ${selected}>${escaparHtml(op)}</option>`;
    }).join("");
 
    return `
        <select class="select-anomalia ${cls}" onchange="${handlerJs}">
            ${opciones}
        </select>
    `;
}
 
function renderizarTabla(filas) {
    const tbody = document.querySelector("#tablaCalculos tbody");
    if (!filas || filas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="empty-msg">Sin registros que coincidan con el filtro seleccionado.</td></tr>`;
        return;
    }
 
    tbody.innerHTML = filas.map((f, idx) => {
        const clasesTr = [f.claseFila, claseFilaPorAnomalia(f.anomalia)].filter(Boolean).join(" ");
        const yaEnReporte = reporteMap.has(normalizarId(f.deviceId));
        return `
            <tr class="${clasesTr}">
                <td><strong>${idx + 1}</strong></td>
                <td>${escaparHtml(f.deviceId)}</td>
                <td>${escaparHtml(f.accountNo)}</td>
                <td>${escaparHtml(f.descripcion)}</td>
                <td><span class="badge ${f.claseBadge}">${escaparHtml(f.estadoTexto)}</span></td>
                <td>${escaparHtml(f.desfase)}</td>
                <td>${escaparHtml(f.fechaOriginal)}</td>
                <td>${escaparHtml(f.fechaCorregida)}</td>
                <td>${escaparHtml(f.ip)}</td>
                <td>${escaparHtml(f.phone)}</td>
                <td>${renderizarSelectorAnomalia(f.anomalia, `cambiarAnomaliaFila(${f._idxOriginal}, this.value)`)}</td>
                <td>
                    <button class="btn ${yaEnReporte ? "btn-success" : "btn-primary"} btn-sm" type="button" onclick="enviarAReporte(${f._idxOriginal})">
                        ${yaEnReporte ? "En reporte" : "Enviar a reporte"}
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}
 
function renderizarParaReportar() {
    const tbody = document.querySelector("#tablaParaReportar tbody");
    const badge = document.getElementById("contadorReporte");
    const lista = Array.from(reporteMap.values());
 
    if (badge) {
        badge.textContent = `${lista.length} ${lista.length === 1 ? "en reporte" : "en reporte"}`;
    }
 
    if (!tbody) return;
 
    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="empty-msg">Usa <strong>Enviar a reporte</strong> en los resultados para agregar medidores aquí.</td></tr>`;
        return;
    }
 
    tbody.innerHTML = lista.map((m, idx) => {
        const clsFila = claseFilaPorAnomalia(m.anomalia);
        return `
            <tr class="${clsFila}">
                <td><strong>${idx + 1}</strong></td>
                <td>${escaparHtml(m.codigo)}</td>
                <td>${escaparHtml(m.nombre)}</td>
                <td>${escaparHtml(m.medidor)}</td>
                <td>${escaparHtml(m.tipo)}</td>
                <td>${escaparHtml(m.delegacion)}</td>
                <td>${escaparHtml(m.localidad)}</td>
                <td>${escaparHtml(m.principalRespaldo || "Principal")}</td>
                <td>${escaparHtml(m.lastRead)}</td>
                <td>${escaparHtml(m.ip)}</td>
                <td>${escaparHtml(m.phone)}</td>
                <td>${renderizarSelectorAnomalia(m.anomalia, `cambiarAnomaliaReporte('${escaparAttr(m.medidor)}', this.value)`)}</td>
                <td>
                    <button class="btn btn-danger btn-sm" type="button" onclick="quitarDeReporte('${escaparAttr(m.medidor)}')">
                        Quitar de reporte
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}
 
function limpiarCajaEntrada() {
    document.getElementById("txtEntrada").value = "";
    mostrarAviso("Caja de pegado limpia.");
}
 
function limpiarTodo() {
    solicitarConfirmacion({
        titulo: "Limpiar todo",
        mensaje: "¿Deseas limpiar los datos pegados, los resultados calculados y la lista Para reportar?",
        textoConfirmar: "Sí, limpiar todo",
        onConfirm: () => {
            document.getElementById("txtEntrada").value = "";
            document.getElementById("contadorFilas").textContent = "0 filas";
            ultimasFilasCalculadas = [];
            filtrosActivos = new Set(["todos"]);
            ordenActual = { campo: null, direccion: "asc" };
            reporteMap.clear();
            localStorage.removeItem(STORAGE_ULTIMA_TABLA);
            localStorage.removeItem(STORAGE_REPORTE);
            localStorage.removeItem(STORAGE_TEXTO_RAW);
            const input = document.getElementById("filtroCodigos");
            if (input) input.value = "";
            const selAnom = document.getElementById("filtroTipoAnomalia");
            if (selAnom) selAnom.value = "";
            sincronizarChips();
            actualizarIndicadoresOrden();
            renderizarTabla([]);
            renderizarParaReportar();
            mostrarAviso("Todo limpio.");
        }
    });
}
 
function copiarColumnasCalculadas() {
    const visibles = obtenerFilasVisibles();
    if (!visibles.length) {
        mostrarAviso("No hay columnas calculadas para copiar.");
        return;
    }
 
    const lineas = visibles.map(f =>
        [f.estadoTexto, f.desfase, f.fechaOriginal, f.fechaCorregida, f.ip, f.phone || "", f.anomalia || ""].join("\t")
    );
 
    navigator.clipboard.writeText(lineas.join("\n"))
        .then(() => mostrarAviso(`Copiadas ${visibles.length} filas listas para Excel.`))
        .catch(() => mostrarAviso("No se pudo copiar al portapapeles."));
}
 
function copiarParaReportar() {
    const lista = Array.from(reporteMap.values());
    if (!lista.length) {
        mostrarAviso("No hay medidores en Para reportar.");
        return;
    }
 
    const lineas = lista.map(m => {
        const ip = (m.ip || "").trim();
        const phone = (m.phone || "").trim();
        const ipPhoneCombinado = ip && phone ? `${ip},${phone}` : (ip || phone);
 
        return [
            m.codigo,
            m.nombre,
            m.medidor,
            m.tipo,
            m.delegacion,
            m.localidad,
            m.principalRespaldo || "Principal",
            m.lastRead,
            ipPhoneCombinado,
            m.anomalia || ""
        ].join("\t");
    });
 
    navigator.clipboard.writeText(lineas.join("\n"))
        .then(() => mostrarAviso("Tabla Para reportar copiada para Excel."))
        .catch(() => mostrarAviso("No se pudo copiar al portapapeles."));
}
 
function escaparHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
 
function escaparAttr(str) {
    return String(str ?? "").replace(/'/g, "\\'");
}
