from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import shutil
from typing import Optional
from rag_processor import RAGProcessor
import uvicorn
from dotenv import load_dotenv
import traceback

# Try to import YouTube processor
try:
    from youtube_processor import YouTubeProcessor
    YOUTUBE_ENABLED = True
    print("YouTube processing enabled")
except ImportError as e:
    print(f"YouTube processing disabled: {e}")
    print("To enable YouTube features, install: pip install youtube-transcript-api==0.6.1 pytube==15.0.0")
    YOUTUBE_ENABLED = False
    YouTubeProcessor = None

# Explicitly load environment variables
load_dotenv()

# Debug: Check if environment variables are loaded
print("Environment variables check:")
print(f"GROQ_API_KEY loaded: {'Yes' if os.getenv('GROQ_API_KEY') else 'No'}")
if os.getenv('GROQ_API_KEY'):
    print(f"Key starts with: {os.getenv('GROQ_API_KEY')[:10]}...")

# Initialize FastAPI app
app = FastAPI(title="RAG Notes AI Backend", version="2.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # React app URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize processors
try:
    rag_processor = RAGProcessor()
    print("✅ RAG Processor initialized successfully!")
except Exception as e:
    print(f"❌ Error initializing RAG Processor: {e}")
    traceback.print_exc()
    rag_processor = None

try:
    if YOUTUBE_ENABLED:
        youtube_processor = YouTubeProcessor()
        print("✅ YouTube Processor initialized successfully!")
    else:
        youtube_processor = None
except Exception as e:
    print(f"❌ Error initializing YouTube Processor: {e}")
    traceback.print_exc()
    youtube_processor = None

# Create uploads directory
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Pydantic models for Notes
class QueryRequest(BaseModel):
    user_id: str
    question: str

class DeleteRequest(BaseModel):
    user_id: str
    filename: Optional[str] = None

# Pydantic models for YouTube
class YouTubeProcessRequest(BaseModel):
    user_id: str
    video_url: str
    language: str = "english"  # english or hindi

class YouTubeQueryRequest(BaseModel):
    user_id: str
    question: str

class YouTubeDeleteRequest(BaseModel):
    user_id: str
    video_id: str

class PastedTranscriptRequest(BaseModel):
    user_id: str
    transcript_text: str
    video_title: Optional[str] = "Pasted Video"
    video_url: Optional[str] = ""

@app.post("/process-pasted-transcript")
def process_pasted_transcript(request: PastedTranscriptRequest):
    """Process manually pasted transcript"""
    if not youtube_processor:
        raise HTTPException(status_code=500, detail="YouTube processing not available")
        
    try:
        print(f"📝 Pasted transcript request - User: {request.user_id}, Title: {request.video_title}")
        
        result = youtube_processor.process_pasted_transcript(
            request.transcript_text, 
            request.user_id, 
            request.video_title,
            request.video_url
        )
        
        if result["success"]:
            print(f"✅ Pasted transcript processed: {result['message']}")
            return result
        else:
            print(f"❌ Pasted transcript failed: {result['error']}")
            raise HTTPException(status_code=400, detail=result["error"])
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Pasted transcript error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

@app.get("/")
def read_root():
    return {
        "message": "RAG Notes AI Backend is running!",
        "version": "2.0.0",
        "features": {
            "notes_processing": "✅" if rag_processor else "❌",
            "youtube_processing": "✅" if youtube_processor else "❌"
        }
    }

# ================ NOTES ENDPOINTS (Phase 2) ================

@app.post("/upload-document")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    """Upload and process document for RAG"""
    if not rag_processor:
        raise HTTPException(status_code=500, detail="RAG Processor not initialized")
        
    try:
        print(f"📄 Upload request - File: {file.filename}, User: {user_id}")
        
        # Validate file type
        if not file.filename.lower().endswith(('.pdf', '.txt')):
            raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported")
        
        # Save uploaded file
        file_path = os.path.join(UPLOAD_DIR, f"{user_id}_{file.filename}")
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        print(f"💾 File saved to: {file_path}")
        
        # Process document with RAG
        result = rag_processor.process_document(file_path, user_id, file.filename)
        
        # Clean up uploaded file
        os.remove(file_path)
        print(f"🗑️ Cleaned up file: {file_path}")
        
        if result["success"]:
            print(f"✅ Successfully processed: {result['message']}")
            return {
                "success": True,
                "message": result["message"],
                "filename": file.filename,
                "chunks_count": result["chunks_count"]
            }
        else:
            print(f"❌ Processing failed: {result['error']}")
            raise HTTPException(status_code=500, detail=result["error"])
            
    except Exception as e:
        print(f"❌ Upload error: {str(e)}")
        traceback.print_exc()
        # Clean up file if it exists
        if 'file_path' in locals() and os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/query")
def query_notes(request: QueryRequest):
    """Query user's notes using RAG"""
    if not rag_processor:
        raise HTTPException(status_code=500, detail="RAG Processor not initialized")
        
    try:
        print(f"❓ Query request - User: {request.user_id}, Question: {request.question}")
        
        result = rag_processor.query_documents(request.user_id, request.question)
        
        if result["success"]:
            print(f"✅ Query successful - Answer length: {len(result['answer'])}")
            return result
        else:
            print(f"❌ Query failed: {result['error']}")
            raise HTTPException(status_code=400, detail=result["error"])
            
    except Exception as e:
        print(f"❌ Query error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")

@app.get("/notes-info/{user_id}")
def get_notes_info(user_id: str):
    """Get information about user's stored notes"""
    if not rag_processor:
        raise HTTPException(status_code=500, detail="RAG Processor not initialized")
        
    try:
        print(f"ℹ️ Notes info request for user: {user_id}")
        result = rag_processor.get_user_notes_info(user_id)
        
        if result["success"]:
            print(f"✅ Notes info retrieved: {result}")
            return result
        else:
            print(f"❌ Notes info failed: {result['error']}")
            raise HTTPException(status_code=500, detail=result["error"])
            
    except Exception as e:
        print(f"❌ Notes info error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete-notes")
def delete_notes(request: DeleteRequest):
    """Delete user's notes"""
    if not rag_processor:
        raise HTTPException(status_code=500, detail="RAG Processor not initialized")
        
    try:
        print(f"🗑️ Delete request - User: {request.user_id}, File: {request.filename}")
        
        result = rag_processor.delete_user_notes(request.user_id, request.filename)
        
        if result["success"]:
            print(f"✅ Delete successful: {result['message']}")
            return result
        else:
            print(f"❌ Delete failed: {result['error']}")
            raise HTTPException(status_code=400, detail=result["error"])
            
    except Exception as e:
        print(f"❌ Delete error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ================ YOUTUBE ENDPOINTS (Phase 3) ================

@app.post("/process-youtube-video")
def process_youtube_video(request: YouTubeProcessRequest):
    """Process YouTube video for RAG"""
    if not youtube_processor:
        raise HTTPException(status_code=500, detail="YouTube processing not available. Please install required packages: pip install youtube-transcript-api==0.6.1 pytube==15.0.0")
        
    try:
        print(f"🎥 YouTube processing request - User: {request.user_id}, URL: {request.video_url}, Language: {request.language}")
        
        result = youtube_processor.process_video(request.video_url, request.user_id, request.language)
        
        if result["success"]:
            print(f"✅ YouTube video processed successfully: {result['message']}")
            return result
        else:
            print(f"❌ YouTube processing failed: {result['error']}")
            # Check if it's a language availability issue
            if 'available_languages' in result:
                raise HTTPException(status_code=400, detail={
                    "error": result["error"],
                    "available_languages": result["available_languages"],
                    "type": "language_not_available"
                })
            raise HTTPException(status_code=400, detail=result["error"])
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ YouTube processing error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"YouTube processing failed: {str(e)}")

@app.post("/query-youtube")
def query_youtube_videos(request: YouTubeQueryRequest):
    """Query user's YouTube videos using RAG"""
    if not youtube_processor:
        raise HTTPException(status_code=500, detail="YouTube processing not available")
        
    try:
        print(f"❓ YouTube query request - User: {request.user_id}, Question: {request.question}")
        
        result = youtube_processor.query_videos(request.user_id, request.question)
        
        if result["success"]:
            print(f"✅ YouTube query successful - Answer length: {len(result['answer'])}")
            return result
        else:
            print(f"❌ YouTube query failed: {result['error']}")
            raise HTTPException(status_code=400, detail=result["error"])
            
    except Exception as e:
        print(f"❌ YouTube query error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"YouTube query failed: {str(e)}")

@app.get("/youtube-info/{user_id}")
def get_youtube_info(user_id: str):
    """Get information about user's stored YouTube videos"""
    if not youtube_processor:
        raise HTTPException(status_code=500, detail="YouTube processing not available")
        
    try:
        print(f"ℹ️ YouTube info request for user: {user_id}")
        result = youtube_processor.get_user_videos_info(user_id)
        
        if result["success"]:
            print(f"✅ YouTube info retrieved: {result}")
            return result
        else:
            print(f"❌ YouTube info failed: {result['error']}")
            raise HTTPException(status_code=500, detail=result["error"])
            
    except Exception as e:
        print(f"❌ YouTube info error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete-youtube-video")
def delete_youtube_video(request: YouTubeDeleteRequest):
    """Delete user's YouTube video"""
    if not youtube_processor:
        raise HTTPException(status_code=500, detail="YouTube processing not available")
        
    try:
        print(f"🗑️ YouTube delete request - User: {request.user_id}, Video: {request.video_id}")
        
        result = youtube_processor.delete_video(request.user_id, request.video_id)
        
        if result["success"]:
            print(f"✅ YouTube delete successful: {result['message']}")
            return result
        else:
            print(f"❌ YouTube delete failed: {result['error']}")
            raise HTTPException(status_code=400, detail=result["error"])
            
    except Exception as e:
        print(f"❌ YouTube delete error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy", 
        "service": "RAG Notes AI Backend",
        "version": "2.0.0",
        "features": {
            "rag_processor": "initialized" if rag_processor else "failed",
            "youtube_processor": "initialized" if youtube_processor else "not_available"
        }
    }

if __name__ == "__main__":
    print("🚀 Starting RAG Notes AI Backend v2.0...")
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))