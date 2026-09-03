const path = require('path');
const fs = require('fs');
const { classify } = require('../middlewares/upload');
const { logActivity } = require('../models/logModel');
const config = require('../config');

// Extra per-category caps, enforced on top of the global multer size limit
// (config.uploads.maxFileSizeMb). Images: 20MB. Voice/audio: 25MB is roughly
// 5 minutes of compressed webm/ogg at typical mic bitrates.
const CATEGORY_MAX_BYTES = {
  image: 20 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
};

// Security: never trust the client-supplied MIME type alone. Before trusting
// an upload classified as an "image", sniff its first bytes against known
// magic numbers for the raster formats we actually accept. A file with a
// spoofed extension/mimetype (e.g. a script renamed to photo.jpg) will fail
// every signature below and get rejected + deleted.
function hasValidImageSignature(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    if (bytesRead < 4) return false;

    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isGif = buf.slice(0, 4).toString('ascii') === 'GIF8';
    const isBmp = buf[0] === 0x42 && buf[1] === 0x4d;
    const isWebp = bytesRead >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';

    return isJpeg || isPng || isGif || isBmp || isWebp;
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { dir, type } = classify(req.file.mimetype, req.file.originalname);

    if (type === 'image' && !hasValidImageSignature(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        success: false,
        message: 'This file does not appear to be a valid image.',
      });
    }

    const categoryMax = CATEGORY_MAX_BYTES[type];
    if (categoryMax && req.file.size > categoryMax) {
      // Delete the file multer already wrote to disk before rejecting.
      fs.unlink(req.file.path, () => {});
      return res.status(413).json({
        success: false,
        message: `${type === 'image' ? 'Images' : 'Voice/audio files'} must be under ${Math.round(categoryMax / (1024 * 1024))}MB.`,
      });
    }

    const relativePath = `/uploads/${dir}/${req.file.filename}`;

    await logActivity(req.user.id, 'file_upload', {
      fileName: req.file.originalname,
      size: req.file.size,
      type,
    }, req.ip);

    res.status(201).json({
      success: true,
      file: {
        url: relativePath,
        name: req.file.originalname,
        size: req.file.size,
        type,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadFile };
