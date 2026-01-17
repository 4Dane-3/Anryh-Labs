"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { 
  Upload, 
  FileVideo, 
  FileAudio, 
  FileImage, 
  Download, 
  X, 
  ChevronDown,
  Shield,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Settings,
  Plus,
  RefreshCw,
  File,
  Link2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Image format options (matching CloudConvert style)
const imageFormats = ["jpg", "png", "webp", "gif", "avif", "bmp", "ico", "tiff"];

// Conversion formats based on input type
const conversionFormats: Record<string, string[]> = {
  // Video formats
  "video/mp4": ["mp4", "mp3", "webm", "avi", "mov", "gif"],
  "video/webm": ["webm", "mp4", "mp3", "avi", "mov", "gif"],
  "video/quicktime": ["mov", "mp4", "webm", "mp3", "avi", "gif"],
  "video/x-msvideo": ["avi", "mp4", "webm", "mp3", "mov", "gif"],
  // Audio formats
  "audio/mpeg": ["mp3", "wav", "ogg", "aac"],
  "audio/wav": ["wav", "mp3", "ogg", "aac"],
  "audio/ogg": ["ogg", "mp3", "wav", "aac"],
  "audio/aac": ["aac", "mp3", "wav", "ogg"],
  // Image formats - expanded list
  "image/png": imageFormats,
  "image/jpeg": imageFormats,
  "image/webp": imageFormats,
  "image/gif": imageFormats,
  "image/avif": imageFormats,
  "image/bmp": imageFormats,
  "image/x-icon": imageFormats,
  "image/tiff": imageFormats,
  // HEIC support
  "image/heic": imageFormats,
  "image/heif": imageFormats,
};

interface FileItem {
  id: string;
  file: File;
  outputFormat: string;
  width: number | null;
  height: number | null;
  originalWidth: number | null;
  originalHeight: number | null;
  maintainAspectRatio: boolean;
  status: "pending" | "converting" | "complete" | "error";
  progress: number;
  convertedBlob: Blob | null;
  convertedUrl: string;
  errorMessage: string;
  showSettings: boolean;
}

export default function FileConverterPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<any>(null);

  // Get file type category
  const getFileCategory = (mimeType: string): "video" | "audio" | "image" | "unknown" => {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("image/")) return "image";
    return "unknown";
  };

  // Check if file is HEIC by extension or mime type
  const isHeicFileByType = (file: File): boolean => {
    const ext = file.name.toLowerCase().split(".").pop();
    return file.type === "image/heic" || 
           file.type === "image/heif" || 
           ext === "heic" || 
           ext === "heif";
  };

  // Get dimensions from file
  const getFileDimensions = async (file: File): Promise<{ width: number; height: number } | null> => {
    const mimeType = getEffectiveMimeType(file);
    const category = getFileCategory(mimeType);
    
    if (category === "image") {
      try {
        let imageBlob: Blob = file;
        
        // Convert HEIC to PNG first to get dimensions
        if (isHeicFileByType(file)) {
          try {
            const heic2any = (await import("heic2any")).default;
            const result = await heic2any({
              blob: file,
              toType: "image/png",
              quality: 0.5, // Lower quality just for dimension detection
            });
            imageBlob = Array.isArray(result) ? result[0] : result;
          } catch (e) {
            return null;
          }
        }
        
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve({ width: img.width, height: img.height });
            URL.revokeObjectURL(img.src);
          };
          img.onerror = () => resolve(null);
          img.src = URL.createObjectURL(imageBlob);
        });
      } catch {
        return null;
      }
    } else if (category === "video") {
      return new Promise((resolve) => {
        const video = document.createElement("video");
        video.onloadedmetadata = () => {
          resolve({ width: video.videoWidth, height: video.videoHeight });
          URL.revokeObjectURL(video.src);
        };
        video.onerror = () => resolve(null);
        video.src = URL.createObjectURL(file);
      });
    } else {
      return null;
    }
  };

  // Load FFmpeg
  const loadFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      
      const ffmpeg = new FFmpeg();
      
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      
      ffmpegRef.current = ffmpeg;
      setFfmpegLoaded(true);
      return ffmpeg;
    } catch (error) {
      console.error("Failed to load FFmpeg:", error);
      throw new Error("Failed to load conversion engine.");
    }
  };

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  // Get effective mime type (handles HEIC detection by extension)
  const getEffectiveMimeType = (file: File): string => {
    if (file.type) return file.type;
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "heic" || ext === "heif") return "image/heic";
    return "";
  };

  // Add files to the list
  const addFiles = async (newFiles: File[]) => {
    const validFiles = newFiles.filter(file => {
      const mimeType = getEffectiveMimeType(file);
      const formats = conversionFormats[mimeType];
      return formats && formats.length > 0;
    });

    const fileItems: FileItem[] = await Promise.all(validFiles.map(async (file) => {
      const mimeType = getEffectiveMimeType(file);
      const dimensions = await getFileDimensions(file);
      return {
        id: Math.random().toString(36).substr(2, 9),
        file,
        outputFormat: conversionFormats[mimeType]?.[0] || "jpg",
        width: dimensions?.width || null,
        height: dimensions?.height || null,
        originalWidth: dimensions?.width || null,
        originalHeight: dimensions?.height || null,
        maintainAspectRatio: true,
        status: "pending" as const,
        progress: 0,
        convertedBlob: null,
        convertedUrl: "",
        errorMessage: "",
        showSettings: false,
      };
    }));

    setFiles(prev => [...prev, ...fileItems]);
  };

  // Handle drag events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // Update file item
  const updateFile = (id: string, updates: Partial<FileItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  // Handle dimension change with aspect ratio
  const handleDimensionChange = (id: string, dimension: "width" | "height", value: number | null) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== id) return f;
      
      if (!f.maintainAspectRatio || !f.originalWidth || !f.originalHeight || value === null) {
        return { ...f, [dimension]: value };
      }
      
      const aspectRatio = f.originalWidth / f.originalHeight;
      
      if (dimension === "width") {
        return { ...f, width: value, height: Math.round(value / aspectRatio) };
      } else {
        return { ...f, height: value, width: Math.round(value * aspectRatio) };
      }
    }));
  };

  // Remove file
  const removeFile = (id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file?.convertedUrl) {
        URL.revokeObjectURL(file.convertedUrl);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  // Toggle settings
  const toggleSettings = (id: string) => {
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, showSettings: !f.showSettings } : f
    ));
  };

  // Convert HEIC to a standard format first
  const convertHeicToBlob = async (file: File): Promise<Blob> => {
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({
      blob: file,
      toType: "image/png",
      quality: 0.95,
    });
    return Array.isArray(result) ? result[0] : result;
  };

  // Get mime type for output format
  const getOutputMimeType = (format: string): string => {
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      bmp: "image/bmp",
      ico: "image/x-icon",
      tiff: "image/tiff",
    };
    return mimeTypes[format] || `image/${format}`;
  };

  // Convert image using canvas
  const convertImage = async (fileItem: FileItem): Promise<Blob> => {
    let sourceBlob: Blob = fileItem.file;
    
    // Handle HEIC files - convert to PNG first
    if (isHeicFileByType(fileItem.file)) {
      sourceBlob = await convertHeicToBlob(fileItem.file);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      
      img.onload = () => {
        const outputWidth = fileItem.width || img.width;
        const outputHeight = fileItem.height || img.height;
        
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        ctx?.drawImage(img, 0, 0, outputWidth, outputHeight);
        
        const mimeType = getOutputMimeType(fileItem.outputFormat);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Failed to convert image"));
            }
          },
          mimeType,
          0.92
        );
        
        URL.revokeObjectURL(img.src);
      };
      
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(sourceBlob);
    });
  };

  // Convert video/audio using FFmpeg
  const convertMedia = async (
    fileItem: FileItem,
    onProgress: (progress: number) => void
  ): Promise<Blob> => {
    const ffmpeg = await loadFFmpeg();
    const { fetchFile } = await import("@ffmpeg/util");
    
    const { file, outputFormat, width, height } = fileItem;
    const inputName = `input_${fileItem.id}.${file.name.split(".").pop()}`;
    const outputName = `output_${fileItem.id}.${outputFormat}`;
    
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    
    // Set up progress tracking
    ffmpeg.on("progress", ({ progress }: { progress: number }) => {
      onProgress(Math.round(progress * 100));
    });
    
    // Build FFmpeg command based on output format
    let command: string[] = ["-i", inputName];
    
    // Add scaling if dimensions are specified
    const hasCustomDimensions = width && height && fileItem.originalWidth && fileItem.originalHeight &&
      (width !== fileItem.originalWidth || height !== fileItem.originalHeight);
    
    if (outputFormat === "mp3") {
      command.push("-vn", "-acodec", "libmp3lame", "-q:a", "2");
    } else if (outputFormat === "wav") {
      command.push("-vn", "-acodec", "pcm_s16le");
    } else if (outputFormat === "ogg") {
      command.push("-vn", "-acodec", "libvorbis", "-q:a", "4");
    } else if (outputFormat === "webm") {
      if (hasCustomDimensions) {
        command.push("-vf", `scale=${width}:${height}`);
      }
      command.push("-c:v", "libvpx", "-c:a", "libvorbis");
    } else if (outputFormat === "gif") {
      const gifWidth = width || 480;
      command.push("-vf", `fps=10,scale=${gifWidth}:-1:flags=lanczos`, "-loop", "0");
    } else if (outputFormat === "mp4") {
      if (hasCustomDimensions) {
        command.push("-vf", `scale=${width}:${height}`);
      }
      command.push("-c:v", "libx264", "-c:a", "aac");
    } else if (outputFormat === "avi") {
      if (hasCustomDimensions) {
        command.push("-vf", `scale=${width}:${height}`);
      }
      command.push("-c:v", "mpeg4", "-c:a", "mp3");
    } else if (outputFormat === "mov") {
      if (hasCustomDimensions) {
        command.push("-vf", `scale=${width}:${height}`);
      }
      command.push("-c:v", "libx264", "-c:a", "aac");
    }
    
    command.push(outputName);
    
    await ffmpeg.exec(command);
    
    const data = await ffmpeg.readFile(outputName);
    const mimeTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      aac: "audio/aac",
      mp4: "video/mp4",
      webm: "video/webm",
      avi: "video/x-msvideo",
      mov: "video/quicktime",
      gif: "image/gif",
    };
    
    // Cleanup
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    
    return new Blob([data], { type: mimeTypes[outputFormat] || "application/octet-stream" });
  };

  // Convert single file
  const convertFile = async (fileItem: FileItem) => {
    updateFile(fileItem.id, { status: "converting", progress: 0 });
    
    try {
      const category = getFileCategory(fileItem.file.type);
      let blob: Blob;
      
      if (category === "image") {
        // Simulate progress for images
        for (let i = 0; i <= 90; i += 30) {
          updateFile(fileItem.id, { progress: i });
          await new Promise(r => setTimeout(r, 100));
        }
        
        blob = await convertImage(fileItem);
        updateFile(fileItem.id, { progress: 100 });
      } else {
        blob = await convertMedia(fileItem, (progress) => {
          updateFile(fileItem.id, { progress });
        });
      }
      
      const url = URL.createObjectURL(blob);
      updateFile(fileItem.id, {
        status: "complete",
        progress: 100,
        convertedBlob: blob,
        convertedUrl: url,
      });
    } catch (error) {
      console.error("Conversion error:", error);
      updateFile(fileItem.id, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Conversion failed",
      });
    }
  };

  // Convert all files
  const convertAll = async () => {
    setIsConverting(true);
    
    const pendingFiles = files.filter(f => f.status === "pending" || f.status === "error");
    
    for (const fileItem of pendingFiles) {
      await convertFile(fileItem);
    }
    
    setIsConverting(false);
  };

  // Download file
  const downloadFile = (fileItem: FileItem) => {
    if (!fileItem.convertedUrl) return;
    
    const link = document.createElement("a");
    link.href = fileItem.convertedUrl;
    link.download = `${fileItem.file.name.split(".")[0]}.${fileItem.outputFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download all
  const downloadAll = () => {
    files.filter(f => f.status === "complete").forEach(downloadFile);
  };

  // Reset all
  const resetAll = () => {
    files.forEach(f => {
      if (f.convertedUrl) {
        URL.revokeObjectURL(f.convertedUrl);
      }
    });
    setFiles([]);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      files.forEach(f => {
        if (f.convertedUrl) {
          URL.revokeObjectURL(f.convertedUrl);
        }
      });
    };
  }, []);

  // Get icon based on file type
  const getFileIcon = (mimeType: string) => {
    const category = getFileCategory(mimeType);
    switch (category) {
      case "video": return <FileVideo className="w-5 h-5" />;
      case "audio": return <FileAudio className="w-5 h-5" />;
      case "image": return <FileImage className="w-5 h-5" />;
      default: return <File className="w-5 h-5" />;
    }
  };

  // Check if file supports dimensions (not audio)
  const supportsDimensions = (mimeType: string) => {
    const category = getFileCategory(mimeType);
    return category === "video" || category === "image";
  };

  const completedCount = files.filter(f => f.status === "complete").length;
  const hasFiles = files.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0b]">
      {/* Header */}
      <header className="relative z-20 w-full border-b border-white/10">
        <div className="mx-auto flex h-[75px] max-w-[1336px] items-center justify-between px-6">
          <Link href="/" className="text-[28px] font-manifold font-bold tracking-tight text-white">
            Anryh Labs
          </Link>
          
          <nav className="flex items-center gap-6">
            <Link href="/our-story" className="text-sm text-white/70 hover:text-white transition-colors hidden sm:block">
              Our story
            </Link>
            <Link href="/open-source-apps" className="text-sm text-white hover:text-white transition-colors hidden sm:block">
              Open-Sourced Apps
            </Link>
            <Link href="/companies" className="text-sm text-white/70 hover:text-white transition-colors hidden md:block">
              Companies
            </Link>
            <Link href="/write" className="text-sm text-white/70 hover:text-white transition-colors hidden md:block">
              Write
            </Link>
            <Button className="h-[38px] px-4 bg-white text-black text-sm font-normal rounded-full hover:bg-white/90 transition-colors">
              Get started
            </Button>
          </nav>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col px-6 py-12">
        <div className="w-full max-w-4xl mx-auto">
          {/* Back Link */}
          <Link 
            href="/open-source-apps" 
            className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Apps
          </Link>

          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <h1 className="font-manifold text-4xl md:text-5xl font-bold text-white mb-4">
              File Converter
            </h1>
            <p className="text-white/60 text-lg">
              Convert video, audio, and image files instantly in your browser.
            </p>
          </motion.div>

          {/* Privacy Badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex justify-center mb-8"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-full">
              <Shield className="w-4 h-4 text-green-400" />
              <span className="text-green-400 text-sm font-medium">
                Files never leave your computer
              </span>
            </div>
          </motion.div>

          {/* Converter Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="bg-[#111113] border-white/10 overflow-hidden">
              {/* File List */}
              {hasFiles && (
                <div className="divide-y divide-white/10">
                  <AnimatePresence>
                    {files.map((fileItem) => (
                      <motion.div
                        key={fileItem.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        {/* File Row */}
                        <div className="flex items-center gap-4 p-4">
                          {/* File Icon */}
                          <div className="text-white/40">
                            {getFileIcon(getEffectiveMimeType(fileItem.file))}
                          </div>
                          
                          {/* File Name */}
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {fileItem.file.name}
                            </p>
                            {fileItem.status === "converting" && (
                              <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full bg-orange-500"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${fileItem.progress}%` }}
                                />
                              </div>
                            )}
                            {fileItem.status === "error" && (
                              <p className="text-red-400 text-xs mt-1">{fileItem.errorMessage}</p>
                            )}
                          </div>

                          {/* Status Icon */}
                          {fileItem.status === "converting" && (
                            <RefreshCw className="w-4 h-4 text-orange-500 animate-spin" />
                          )}
                          {fileItem.status === "complete" && (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          )}
                          {fileItem.status === "error" && (
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          )}

                          {/* Convert To Label */}
                          <span className="text-white/40 text-sm hidden sm:block">Convert to</span>

                          {/* Format Dropdown */}
                          <div className="relative">
                            <select
                              value={fileItem.outputFormat}
                              onChange={(e) => updateFile(fileItem.id, { outputFormat: e.target.value })}
                              disabled={fileItem.status === "converting" || fileItem.status === "complete"}
                              className="appearance-none bg-[#1a1a1c] border border-white/10 rounded-lg px-3 py-2 pr-8 text-white text-sm uppercase font-medium focus:outline-none focus:border-white/30 disabled:opacity-50 cursor-pointer"
                            >
                              {conversionFormats[getEffectiveMimeType(fileItem.file)]?.map(format => (
                                <option key={format} value={format}>{format}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                          </div>

                          {/* Settings Button */}
                          {supportsDimensions(getEffectiveMimeType(fileItem.file)) && (
                            <button
                              onClick={() => toggleSettings(fileItem.id)}
                              disabled={fileItem.status === "converting" || fileItem.status === "complete"}
                              className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                                fileItem.showSettings 
                                  ? "bg-white/10 text-white" 
                                  : "text-white/40 hover:text-white hover:bg-white/10"
                              }`}
                            >
                              <Settings className="w-5 h-5" />
                            </button>
                          )}

                          {/* Download Button (if complete) */}
                          {fileItem.status === "complete" && (
                            <button
                              onClick={() => downloadFile(fileItem)}
                              className="p-2 text-green-500 hover:bg-green-500/10 rounded-lg transition-colors"
                            >
                              <Download className="w-5 h-5" />
                            </button>
                          )}

                          {/* Remove Button */}
                          <button
                            onClick={() => removeFile(fileItem.id)}
                            disabled={fileItem.status === "converting"}
                            className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        {/* Settings Panel - Dimensions */}
                        <AnimatePresence>
                          {fileItem.showSettings && supportsDimensions(getEffectiveMimeType(fileItem.file)) && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-white/5 border-t border-white/10 px-4 py-4"
                            >
                              <div className="flex flex-wrap items-center gap-4">
                                <span className="text-white/60 text-sm">Output Size:</span>
                                
                                {/* Width Input */}
                                <div className="flex items-center gap-2">
                                  <label className="text-white/40 text-xs">W</label>
                                  <input
                                    type="number"
                                    value={fileItem.width || ""}
                                    onChange={(e) => handleDimensionChange(
                                      fileItem.id, 
                                      "width", 
                                      e.target.value ? parseInt(e.target.value) : null
                                    )}
                                    placeholder={fileItem.originalWidth?.toString() || "auto"}
                                    className="w-20 bg-[#1a1a1c] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-white/30"
                                  />
                                  <span className="text-white/40 text-xs">px</span>
                                </div>

                                {/* Aspect Ratio Lock */}
                                <button
                                  onClick={() => updateFile(fileItem.id, { 
                                    maintainAspectRatio: !fileItem.maintainAspectRatio 
                                  })}
                                  className={`p-1.5 rounded transition-colors ${
                                    fileItem.maintainAspectRatio 
                                      ? "text-orange-500 bg-orange-500/10" 
                                      : "text-white/40 hover:text-white"
                                  }`}
                                  title={fileItem.maintainAspectRatio ? "Aspect ratio locked" : "Aspect ratio unlocked"}
                                >
                                  <Link2 className="w-4 h-4" />
                                </button>

                                {/* Height Input */}
                                <div className="flex items-center gap-2">
                                  <label className="text-white/40 text-xs">H</label>
                                  <input
                                    type="number"
                                    value={fileItem.height || ""}
                                    onChange={(e) => handleDimensionChange(
                                      fileItem.id, 
                                      "height", 
                                      e.target.value ? parseInt(e.target.value) : null
                                    )}
                                    placeholder={fileItem.originalHeight?.toString() || "auto"}
                                    className="w-20 bg-[#1a1a1c] border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-white/30"
                                  />
                                  <span className="text-white/40 text-xs">px</span>
                                </div>

                                {/* Original dimensions info */}
                                {fileItem.originalWidth && fileItem.originalHeight && (
                                  <span className="text-white/30 text-xs">
                                    Original: {fileItem.originalWidth} × {fileItem.originalHeight}
                                  </span>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* Add Files Button / Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  p-6 cursor-pointer transition-all border-t border-white/10
                  ${!hasFiles ? "py-16" : ""}
                  ${isDragging 
                    ? "bg-orange-500/10" 
                    : "hover:bg-white/5"
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="video/*,audio/*,image/*,.heic,.heif"
                  onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))}
                />
                
                <div className="flex items-center justify-center gap-3">
                  {hasFiles ? (
                    <>
                      <Plus className="w-5 h-5 text-white/60" />
                      <span className="text-white/60 font-medium">Add more Files</span>
                      <ChevronDown className="w-4 h-4 text-white/40" />
                    </>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-12 h-12 text-white/40 mx-auto mb-4" />
                      <p className="text-white font-medium mb-2">
                        Drop your files here or click to browse
                      </p>
                      <p className="text-white/40 text-sm">
                        Supports video, audio, and image files
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Bar */}
              {hasFiles && (
                <div className="flex items-center justify-between p-4 border-t border-white/10 bg-[#0d0d0e]">
                  <div className="text-white/40 text-sm">
                    {files.length} file{files.length !== 1 ? "s" : ""} 
                    {completedCount > 0 && ` · ${completedCount} converted`}
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {completedCount > 0 && completedCount === files.length && (
                      <Button
                        onClick={resetAll}
                        variant="outline"
                        className="border-white/20 text-black bg-white hover:bg-white/90"
                      >
                        Convert Another
                      </Button>
                    )}
                    
                    {completedCount > 0 && (
                      <Button
                        onClick={downloadAll}
                        className="bg-green-500 hover:bg-green-600 text-white"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download All
                      </Button>
                    )}
                    
                    {files.some(f => f.status === "pending" || f.status === "error") && (
                      <Button
                        onClick={convertAll}
                        disabled={isConverting}
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        {isConverting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Converting...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Convert
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Supported Formats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-8 text-center"
          >
            <p className="text-white/40 text-sm mb-3">Supported formats</p>
            <div className="flex flex-wrap justify-center gap-2">
              {["MP4", "WEBM", "MOV", "AVI", "MP3", "WAV", "OGG", "PNG", "JPG", "WEBP", "GIF", "HEIC", "AVIF", "BMP", "ICO", "TIFF"].map((format) => (
                <span
                  key={format}
                  className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-white/60 text-xs"
                >
                  {format}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="relative z-20 border-t border-white/10 py-6">
        <div className="mx-auto max-w-[1336px] px-6">
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-white/40">
            <Link href="/write" className="hover:text-white transition-colors">Help</Link>
            <Link href="/status" className="hover:text-white transition-colors">Status</Link>
            <Link href="/careers" className="hover:text-white transition-colors">Careers</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
