# ─── Stage 1: Build React Frontend ───────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Build with empty VITE_API_URL so it uses relative URLs in production
RUN VITE_API_URL="" npm run build

# ─── Stage 2: Python Backend ──────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY backend/ ./backend/
COPY models/ ./models/
COPY backend/quality_thresholds.json ./backend/quality_thresholds.json

# Copy built frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create uploads directory
RUN mkdir -p uploads

# Expose port (Railway injects $PORT at runtime)
EXPOSE 8000

# Start FastAPI with uvicorn
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
