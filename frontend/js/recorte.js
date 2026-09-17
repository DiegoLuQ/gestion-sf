// Ventana para recortar imágenes a 1:1 con Cropper.js (incluido en /vendor, se carga solo cuando se usa).
import { $, h, icon, openModal, toast } from './ui.js';

let loading = null;

export function loadCropper() {
  if (window.Cropper) return Promise.resolve(window.Cropper);
  loading ??= new Promise((resolve, reject) => {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/vendor/cropperjs/cropper.min.css' }));
    const script = Object.assign(document.createElement('script'), { src: '/vendor/cropperjs/cropper.min.js' });
    script.onload = () => resolve(window.Cropper);
    script.onerror = () => { loading = null; reject(new Error('No se pudo cargar el recortador de imágenes.')); };
    document.head.append(script);
  });
  return loading;
}

const PREVIEW_PX = 240;

// Vista previa de "imagen completa": la imagen centrada en un cuadrado blanco (igual que hará el servidor).
function paddedPreview(img) {
  const canvas = Object.assign(document.createElement('canvas'), { width: PREVIEW_PX, height: PREVIEW_PX });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PREVIEW_PX, PREVIEW_PX);
  const scale = PREVIEW_PX / Math.max(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * scale;
  const hgt = img.naturalHeight * scale;
  ctx.drawImage(img, (PREVIEW_PX - w) / 2, (PREVIEW_PX - hgt) / 2, w, hgt);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Abre la ventana de recorte.
 * Resuelve con { crop: {x, y, width, height}, previewUrl } al aplicar el recorte,
 * con { modo: 'completa', previewUrl } al elegir la imagen completa con bordes blancos,
 * o con null si el usuario cancela.
 */
export async function openCropDialog({ src, initialCrop = null }) {
  let Cropper;
  try {
    Cropper = await loadCropper();
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }

  return new Promise(resolve => {
    let settled = false;
    let cropper = null;
    let baseRatio = 1;
    const finish = value => {
      if (settled) return;
      settled = true;
      cropper?.destroy();
      resolve(value);
    };

    const body = h(`<div class="crop-dialog">
        <div class="crop-stage"><img alt="Imagen a recortar"></div>
        <div class="crop-side">
          <div class="crop-preview-wrap"><span>Vista previa</span><div class="crop-preview"></div></div>
          <label class="crop-zoom"><span>Zoom</span><input type="range" min="0" max="100" step="1" value="0" aria-label="Zoom"></label>
          <p class="help">Arrastra la imagen para encuadrarla. Acerca con el control, la rueda del mouse o dos dedos.</p>
        </div>
      </div>`);
    const modal = openModal({
      title: 'Recortar imagen (1:1)',
      size: 'crop',
      body,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-full title="La imagen entera, centrada con bordes blancos">${icon('image')} Usar imagen completa</button>
        <button type="button" class="btn btn-primary" data-apply disabled>${icon('check')} Aplicar recorte</button>`,
    });

    // Cerrar la ventana por cualquier vía (X, Cancelar, Escape, clic afuera) equivale a cancelar.
    const observer = new MutationObserver(() => {
      if (!modal.el.isConnected) { observer.disconnect(); finish(null); }
    });
    observer.observe(document.body, { childList: true });

    const img = $('img', body);
    const zoom = $('input[type=range]', body);
    const applyBtn = $('[data-apply]', modal.el);

    const syncZoom = () => {
      if (!cropper) return;
      const data = cropper.getImageData();
      const ratio = data.width / data.naturalWidth;
      zoom.value = String(Math.max(0, Math.min(100, ((ratio / baseRatio) - 1) / 4 * 100)));
    };

    img.addEventListener('load', () => {
      cropper = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        checkOrientation: false, // el navegador ya muestra la foto orientada; el servidor usa la misma orientación
        background: false,
        toggleDragModeOnDblclick: false,
        preview: $('.crop-preview', body),
        ready() {
          const data = cropper.getImageData();
          baseRatio = data.width / data.naturalWidth;
          if (initialCrop) cropper.setData(initialCrop);
          syncZoom();
          applyBtn.disabled = false;
        },
        zoom() { requestAnimationFrame(syncZoom); },
      });
    }, { once: true });
    img.addEventListener('error', () => {
      toast('No se pudo abrir la imagen para recortarla.', 'error');
      modal.close();
    }, { once: true });
    img.src = src;

    zoom.addEventListener('input', () => {
      if (cropper) cropper.zoomTo(baseRatio * (1 + (Number(zoom.value) / 100) * 4));
    });

    applyBtn.addEventListener('click', () => {
      if (!cropper) return;
      const { x, y, width, height } = cropper.getData(true);
      const canvas = cropper.getCroppedCanvas({ width: PREVIEW_PX, height: PREVIEW_PX, fillColor: '#ffffff', imageSmoothingQuality: 'high' });
      finish({ crop: { x, y, width, height }, previewUrl: canvas.toDataURL('image/jpeg', 0.85) });
      modal.close();
    });

    $('[data-full]', modal.el).addEventListener('click', () => {
      if (!img.naturalWidth) return;
      finish({ modo: 'completa', previewUrl: paddedPreview(img) });
      modal.close();
    });
  });
}
