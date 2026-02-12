const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const Note = require('../models/Note');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();


router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const userId = req.user._id.toString();
    const file = req.file;
    
    // Prepare form data for AI backend
    const formData = new FormData();
    formData.append('file', fs.createReadStream(file.path), file.originalname);
    formData.append('user_id', userId);

    // Send to AI backend
    const aiResponse = await axios.post(
      `${process.env.AI_BACKEND_URL}/upload-document`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
      }
    );

    if (aiResponse.data.success) {
      // Save note metadata to MongoDB
      const note = new Note({
        userId: req.user._id,
        filename: aiResponse.data.filename,
        originalName: file.originalname,
        fileType: file.originalname.split('.').pop().toLowerCase(),
        chunksCount: aiResponse.data.chunks_count
      });

      await note.save();

      // Clean up uploaded file
      fs.unlinkSync(file.path);

      res.json({
        success: true,
        message: aiResponse.data.message,
        note: {
          id: note._id,
          filename: note.filename,
          originalName: note.originalName,
          chunksCount: note.chunksCount,
          uploadedAt: note.uploadedAt
        }
      });
    } else {
      // Clean up uploaded file
      fs.unlinkSync(file.path);
      res.status(500).json({ message: 'Failed to process document' });
    }

  } catch (error) {
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error('Upload error:', error);
    res.status(500).json({ 
      message: 'Upload failed', 
      error: error.response?.data?.detail || error.message 
    });
  }
});

// Query notes with synchronization check
router.post('/query', auth, async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user._id.toString();

    if (!question) {
      return res.status(400).json({ message: 'Question is required' });
    }

    // First check if user has notes in MongoDB
    const mongoNotes = await Note.find({ userId: req.user._id });
    
    if (mongoNotes.length === 0) {
      return res.status(400).json({ 
        message: 'No notes found. Please upload some notes first.' 
      });
    }

    // Check AI backend for vector data
    const aiNotesResponse = await axios.get(
      `${process.env.AI_BACKEND_URL}/notes-info/${userId}`
    );

    // If no vector data found but MongoDB has notes, inform user
    if (aiNotesResponse.data.notes_count === 0) {
      return res.status(400).json({ 
        message: 'Notes found in database but vector data missing. Please re-upload your files.',
        needsReupload: true,
        mongoNotesCount: mongoNotes.length
      });
    }

    // Send query to AI backend
    const aiResponse = await axios.post(
      `${process.env.AI_BACKEND_URL}/query`,
      {
        user_id: userId,
        question: question
      }
    );

    res.json(aiResponse.data);

  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ 
      message: 'Query failed', 
      error: error.response?.data?.detail || error.message 
    });
  }
});

// Get user's notes with synchronization check
router.get('/my-notes', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get notes from MongoDB
    const mongoNotes = await Note.find({ userId }).sort({ createdAt: -1 });

    try {
      // Get notes info from AI backend
      const aiResponse = await axios.get(
        `${process.env.AI_BACKEND_URL}/notes-info/${userId.toString()}`
      );

      // Check synchronization
      const isSync = mongoNotes.length === aiResponse.data.notes_count || 
                    (mongoNotes.length === 0 && aiResponse.data.notes_count === 0);

      res.json({
        success: true,
        notes: mongoNotes,
        vectorInfo: aiResponse.data,
        synchronized: isSync,
        syncMessage: isSync ? 
          'Databases are synchronized' : 
          `Warning: Database mismatch - MongoDB has ${mongoNotes.length} files, Vector DB has ${aiResponse.data.notes_count} chunks`
      });

    } catch (aiError) {
      // AI backend might be down, return MongoDB data with warning
      res.json({
        success: true,
        notes: mongoNotes,
        vectorInfo: { notes_count: 0, files: [] },
        synchronized: false,
        syncMessage: 'Warning: Cannot connect to AI backend. Vector data may be missing.'
      });
    }

  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({ 
      message: 'Failed to get notes', 
      error: error.message 
    });
  }
});

// Delete note with full cleanup
router.delete('/:noteId', auth, async (req, res) => {
  try {
    const { noteId } = req.params;
    const userId = req.user._id;

    // Find note in MongoDB first
    const note = await Note.findOne({ _id: noteId, userId });
    
    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Delete from MongoDB
    await Note.findByIdAndDelete(noteId);

    // Try to delete from AI backend
    try {
      await axios.delete(`${process.env.AI_BACKEND_URL}/delete-notes`, {
        data: {
          user_id: userId.toString(),
          filename: note.filename
        }
      });
    } catch (aiError) {
      console.warn('Failed to delete from AI backend:', aiError.message);
      // Continue anyway - at least MongoDB is cleaned up
    }

    res.json({ 
      success: true, 
      message: 'Note deleted successfully'
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ 
      message: 'Delete failed', 
      error: error.message 
    });
  }
});

// NEW: Cleanup route to sync databases
router.post('/cleanup-sync', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get notes from both databases
    const mongoNotes = await Note.find({ userId });
    
    let aiNotes;
    try {
      const aiResponse = await axios.get(
        `${process.env.AI_BACKEND_URL}/notes-info/${userId.toString()}`
      );
      aiNotes = aiResponse.data;
    } catch {
      aiNotes = { notes_count: 0, files: [] };
    }

    // If MongoDB has notes but AI backend doesn't, clear MongoDB
    if (mongoNotes.length > 0 && aiNotes.notes_count === 0) {
      await Note.deleteMany({ userId });
      
      return res.json({
        success: true,
        message: `Cleaned up ${mongoNotes.length} orphaned file records from database`,
        action: 'cleaned_mongodb'
      });
    }

    // If both are empty or in sync
    if (mongoNotes.length === 0 && aiNotes.notes_count === 0) {
      return res.json({
        success: true,
        message: 'Databases are already clean and synchronized',
        action: 'already_clean'
      });
    }

    res.json({
      success: true,
      message: 'Databases appear to be synchronized',
      mongoCount: mongoNotes.length,
      vectorCount: aiNotes.notes_count,
      action: 'no_action_needed'
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ 
      message: 'Cleanup failed', 
      error: error.message 
    });
  }
});

module.exports = router;