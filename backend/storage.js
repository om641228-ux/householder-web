const { supabase } = require('./supabase');

const BUCKET_NAME = 'receipt-images';

async function uploadReceiptPhoto(fileBuffer, originalName, mimeType) {
  const timestamp = Date.now();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `receipts/${timestamp}_${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false
    });

  if (error) {
    console.error('❌ Storage upload error:', error.message);
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  console.log('✅ Photo uploaded:', filePath);
  return {
    path: filePath,
    url: urlData.publicUrl
  };
}

async function deleteReceiptPhoto(filePath) {
  if (!filePath) return;
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([filePath]);
  if (error) {
    console.error('❌ Storage delete error:', error.message);
  } else {
    console.log('✅ Photo deleted:', filePath);
  }
}

module.exports = { uploadReceiptPhoto, deleteReceiptPhoto, BUCKET_NAME };
