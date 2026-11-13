const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_RAW_FILE_BYTES = 12 * 1024 * 1024; // 12 MB raw input cap
const MAX_DIMENSION = 1400;
const TARGET_QUALITY = 0.82;

export async function compressVehicleImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Formato inválido. Envie apenas imagens JPG, PNG ou WebP.');
  }
  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error('A foto excede o limite máximo de 12 MB.');
  }

  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Não foi possível processar a imagem.'));
      image.src = bitmapUrl;
    });

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width >= height) {
        height = Math.round((height * MAX_DIMENSION) / width);
        width = MAX_DIMENSION;
      } else {
        width = Math.round((width * MAX_DIMENSION) / height);
        height = MAX_DIMENSION;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Falha ao inicializar compressão da imagem.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const compressed = canvas.toDataURL('image/jpeg', TARGET_QUALITY);
    if (compressed.length > 900_000) {
      return canvas.toDataURL('image/jpeg', 0.68);
    }
    return compressed;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}
