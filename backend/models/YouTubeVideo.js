const mongoose = require('mongoose');

const youtubeVideoSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  videoId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  channel: {
    type: String,
    required: true
  },
  thumbnailUrl: {
    type: String,
    required: true
  },
  length: {
    type: Number,
    default: 0
  },
  language: {
    type: String,
    required: true
  },
  chunksCount: {
    type: Number,
    required: true
  },
  originalUrl: {
    type: String,
    required: true
  },
  processedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure unique video per user (user can't add same video twice)
youtubeVideoSchema.index({ userId: 1, videoId: 1 }, { unique: true });

module.exports = mongoose.model('YouTubeVideo', youtubeVideoSchema);