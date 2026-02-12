const express = require('express');
const axios = require('axios');
const YouTubeVideo = require('../models/YouTubeVideo');
const auth = require('../middleware/auth');

const router = express.Router();

// Process YouTube video
router.post('/process', auth, async (req, res) => {
  try {
    const { videoUrl, language = 'english' } = req.body;
    const userId = req.user._id.toString();

    if (!videoUrl) {
      return res.status(400).json({ message: 'Video URL is required' });
    }

    if (!['english', 'hindi'].includes(language.toLowerCase())) {
      return res.status(400).json({ message: 'Language must be either "english" or "hindi"' });
    }

    console.log(`Processing YouTube video: ${videoUrl} for user: ${userId} in ${language}`);

    // Send to AI backend
    const aiResponse = await axios.post(
      `${process.env.AI_BACKEND_URL}/process-youtube-video`,
      {
        user_id: userId,
        video_url: videoUrl,
        language: language.toLowerCase()
      }
    );

    if (aiResponse.data.success) {
      const videoData = aiResponse.data.video_data;
      
      // Check if video already exists for this user
      const existingVideo = await YouTubeVideo.findOne({ 
        userId: req.user._id, 
        videoId: videoData.video_id 
      });

      if (existingVideo) {
        return res.status(400).json({ 
          message: 'This video has already been processed',
          video: existingVideo
        });
      }

      // Save video metadata to MongoDB
      const youtubeVideo = new YouTubeVideo({
        userId: req.user._id,
        videoId: videoData.video_id,
        title: videoData.title,
        channel: videoData.channel,
        thumbnailUrl: videoData.thumbnail,
        length: videoData.length,
        language: videoData.language,
        chunksCount: videoData.chunks_count,
        originalUrl: videoUrl
      });

      await youtubeVideo.save();

      res.json({
        success: true,
        message: aiResponse.data.message,
        video: {
          id: youtubeVideo._id,
          videoId: videoData.video_id,
          title: videoData.title,
          channel: videoData.channel,
          thumbnail: videoData.thumbnail,
          length: videoData.length,
          language: videoData.language,
          chunksCount: videoData.chunks_count,
          processedAt: youtubeVideo.processedAt
        }
      });
    } else {
      // Handle language availability errors
      const errorDetail = aiResponse.data.error || 'Failed to process video';
      
      // Check for language-specific error
      if (aiResponse.data.available_languages) {
        return res.status(400).json({
          message: errorDetail,
          available_languages: aiResponse.data.available_languages,
          suggestion: 'Please try selecting a different language from the available options.'
        });
      }
      
      res.status(500).json({ message: errorDetail });
    }

  } catch (error) {
    console.error('YouTube processing error:', error);
    
    // Handle specific AI backend errors
    if (error.response?.data) {
      const errorData = error.response.data;
      
      // Language availability error
      if (errorData.detail?.available_languages) {
        return res.status(400).json({
          message: errorData.detail.error || 'Transcript not available in selected language',
          available_languages: errorData.detail.available_languages,
          suggestion: 'Please try selecting a different language.'
        });
      }
      
      // General error from AI backend
      return res.status(500).json({ 
        message: 'Video processing failed', 
        error: errorData.detail || error.response.data.message || error.message 
      });
    }
    
    res.status(500).json({ 
      message: 'Video processing failed', 
      error: error.message 
    });
  }
});

// Query YouTube videos
router.post('/query', auth, async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user._id.toString();

    if (!question) {
      return res.status(400).json({ message: 'Question is required' });
    }

    // Check if user has any YouTube videos
    const userVideos = await YouTubeVideo.find({ userId: req.user._id });
    
    if (userVideos.length === 0) {
      return res.status(400).json({ 
        message: 'No YouTube videos found. Please process some videos first.' 
      });
    }

    console.log(`Querying YouTube videos for user: ${userId} with question: ${question}`);

    // Send query to AI backend
    const aiResponse = await axios.post(
      `${process.env.AI_BACKEND_URL}/query-youtube`,
      {
        user_id: userId,
        question: question
      }
    );

    res.json(aiResponse.data);

  } catch (error) {
    console.error('YouTube query error:', error);
    res.status(500).json({ 
      message: 'Query failed', 
      error: error.response?.data?.detail || error.message 
    });
  }
});

// Get user's YouTube videos
router.get('/my-videos', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get videos from MongoDB
    const videos = await YouTubeVideo.find({ userId }).sort({ createdAt: -1 });

    try {
      // Get videos info from AI backend
      const aiResponse = await axios.get(
        `${process.env.AI_BACKEND_URL}/youtube-info/${userId.toString()}`
      );

      res.json({
        success: true,
        videos: videos,
        vectorInfo: aiResponse.data
      });

    } catch (aiError) {
      // AI backend might be down, return MongoDB data with warning
      console.warn('AI backend unavailable for YouTube info:', aiError.message);
      res.json({
        success: true,
        videos: videos,
        vectorInfo: { videos_count: 0, videos: [] },
        warning: 'AI backend unavailable. Videos may not work with queries.'
      });
    }

  } catch (error) {
    console.error('Get YouTube videos error:', error);
    res.status(500).json({ 
      message: 'Failed to get videos', 
      error: error.message 
    });
  }
});
// Process pasted transcript
router.post('/process-pasted', auth, async (req, res) => {
  try {
    const { transcriptText, videoTitle = "Pasted Video", videoUrl = "" } = req.body;
    const userId = req.user._id.toString();

    if (!transcriptText || transcriptText.trim().length < 50) {
      return res.status(400).json({ 
        message: 'Transcript text is required and must be at least 50 characters' 
      });
    }

    console.log(`Processing pasted transcript for user: ${userId}`);

    // Send to AI backend
    const aiResponse = await axios.post(
      `${process.env.AI_BACKEND_URL}/process-pasted-transcript`,
      {
        user_id: userId,
        transcript_text: transcriptText,
        video_title: videoTitle,
        video_url: videoUrl
      }
    );

    if (aiResponse.data.success) {
      const videoData = aiResponse.data.video_data;
      
      // Save to MongoDB
      const youtubeVideo = new YouTubeVideo({
        userId: req.user._id,
        videoId: videoData.video_id,
        title: videoData.title,
        channel: videoData.channel,
        thumbnailUrl: videoData.thumbnail,
        length: videoData.length || 0,
        language: videoData.language,
        chunksCount: videoData.chunks_count,
        originalUrl: videoUrl || "Pasted transcript"
      });

      await youtubeVideo.save();

      res.json({
        success: true,
        message: aiResponse.data.message,
        video: {
          id: youtubeVideo._id,
          videoId: videoData.video_id,
          title: videoData.title,
          channel: videoData.channel,
          thumbnail: videoData.thumbnail,
          chunksCount: videoData.chunks_count,
          processedAt: youtubeVideo.processedAt
        }
      });
    } else {
      res.status(500).json({ message: aiResponse.data.error || 'Failed to process transcript' });
    }

  } catch (error) {
    console.error('Pasted transcript error:', error);
    
    if (error.response?.data) {
      return res.status(500).json({ 
        message: error.response.data.detail || 'Processing failed'
      });
    }
    
    res.status(500).json({ 
      message: 'Processing failed', 
      error: error.message 
    });
  }
});
// Delete YouTube video
router.delete('/:videoId', auth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user._id;

    // Find and delete video from MongoDB
    const video = await YouTubeVideo.findOneAndDelete({ 
      _id: videoId, 
      userId: userId 
    });
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    // Delete from AI backend
    try {
      await axios.delete(`${process.env.AI_BACKEND_URL}/delete-youtube-video`, {
        data: {
          user_id: userId.toString(),
          video_id: video.videoId
        }
      });
    } catch (aiError) {
      console.warn('Failed to delete from AI backend:', aiError.message);
      // Continue anyway - at least MongoDB is cleaned up
    }

    res.json({ 
      success: true, 
      message: 'Video deleted successfully',
      deletedVideo: {
        title: video.title,
        videoId: video.videoId
      }
    });

  } catch (error) {
    console.error('Delete YouTube video error:', error);
    res.status(500).json({ 
      message: 'Delete failed', 
      error: error.message 
    });
  }
});




// Get video languages (helper endpoint)
router.get('/languages/:videoId', auth, async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // This would require calling YouTube API or our AI backend
    // For now, return standard languages
    res.json({
      success: true,
      available_languages: [
        { code: 'en', name: 'English' },
        { code: 'hi', name: 'Hindi' }
      ],
      supported_languages: ['english', 'hindi']
    });

  } catch (error) {
    console.error('Get languages error:', error);
    res.status(500).json({ 
      message: 'Failed to get languages', 
      error: error.message 
    });
  }
});

module.exports = router;