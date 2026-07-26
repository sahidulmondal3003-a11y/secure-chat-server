const path = require('path');
const { classify } = require('../middlewares/upload');
const { logActivity } = require('../models/logModel');
const config = require('../config');

async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { dir, type } = classify(req.file.mimetype, req.file.originalname);
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
