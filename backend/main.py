from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app = FastAPI()


@app.get("/")
def home():
    return {"message": "Marine Debris Detection API is running!"}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    return {
        "filename": file.filename,
        "detections": [
            {
                "class": "debris",
                "confidence": 0.87,
                "x": 100,
                "y": 120,
                "width": 200,
                "height": 150
            },
            {
                "class": "unknown",
                "confidence": 0.34,
                "x": 350,
                "y": 200,
                "width": 100,
                "height": 80
            }
        ]
    }
