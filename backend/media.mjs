// Telegram's stripped thumbnail format uses fixed JPEG quantization / Huffman tables.
// Format reference: https://github.com/gram-js/gramjs/blob/master/gramjs/Utils.ts
const jpegHeader = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300281c1e231e19282321232d2b28303c64413c37373c7b585d4964918099968f808c8aa0b4e6c3a0aadaad8a8cc8ffcbdaeef5ffffff9bc1fffffffaffe6fdfff8ffdb0043012b2d2d3c353c76414176f8a58ca5f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8ffc00011080000000003012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00', 'hex');

export function strippedThumbnail(encoded) {
  if (!encoded || typeof encoded !== 'string' || encoded.length > 200000) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 4) return null;
  if (bytes[0] === 255 && bytes[1] === 216) return bytes;
  if (bytes[0] !== 1 || bytes[1] < 1 || bytes[2] < 1) return null;
  const header = Buffer.from(jpegHeader); header[164] = bytes[1]; header[166] = bytes[2];
  return Buffer.concat([header, bytes.subarray(3), Buffer.from([255, 217])]);
}
export function messageView(message, title, names = new Map()) {
  const raw = message.raw || {};
  const media = raw.Media || {};
  const document = media.Document || media.Webpage?.Document;
  const photo = media.Photo || media.Webpage?.Photo;
  const mime = document?.MimeType || (photo ? 'image/jpeg' : '');
  const filename = message.file || '';
  const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : /\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(filename) ? 'archive' : 'file';
  const thumbs = [...(document?.Thumbs || []), ...(photo?.Sizes || []), ...(media.VideoCover?.Sizes || [])];
  let thumbnail = null;
  for (const thumb of thumbs) { thumbnail = strippedThumbnail(thumb.Bytes); if (thumbnail) break; }
  const senderId = raw.FromID?.UserID || raw.FromID?.ChannelID || raw.FromID?.ChatID;
  const sender = raw.Out ? '我' : raw.PostAuthor || names.get(String(senderId)) || (raw.Post || !senderId ? title : `用户 ${senderId}`);
  const duration = document?.Attributes?.find(attribute => attribute.Duration)?.Duration || 0;
  const size = document?.Size || Math.max(0, ...(photo?.Sizes || []).map(size => size.Size || size.Sizes?.at(-1) || 0));
  return { id: message.id, file: filename, text: message.text || raw.Message || '', date: message.date || raw.Date || 0,
    outgoing: !!raw.Out, sender, hasMedia: !!filename, kind, mime, size, duration,
    thumbnailAvailable:!!message.previewFileLocation,
    thumbnail: thumbnail ? `data:image/jpeg;base64,${thumbnail.toString('base64')}` : null };
}
