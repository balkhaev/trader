import { EventEmitter } from "node:events";
import type { ParsedArticle } from "../types";

export interface NewsEvents {
  "article:new": [article: ParsedArticle, sourceId: string, sourceName: string];
  "article:saved": [
    article: ParsedArticle & { id: string },
    sourceId: string,
    sourceName: string,
  ];
  "source:connected": [sourceId: string, sourceName: string];
  "source:disconnected": [sourceId: string, sourceName: string];
  "source:error": [sourceId: string, sourceName: string, error: Error];
}

class NewsEventEmitter extends EventEmitter {
  emitArticleNew(
    article: ParsedArticle,
    sourceId: string,
    sourceName: string
  ): void {
    this.emit("article:new", article, sourceId, sourceName);
  }

  emitArticleSaved(
    article: ParsedArticle & { id: string },
    sourceId: string,
    sourceName: string
  ): void {
    this.emit("article:saved", article, sourceId, sourceName);
  }

  emitSourceConnected(sourceId: string, sourceName: string): void {
    this.emit("source:connected", sourceId, sourceName);
  }

  emitSourceDisconnected(sourceId: string, sourceName: string): void {
    this.emit("source:disconnected", sourceId, sourceName);
  }

  emitSourceError(sourceId: string, sourceName: string, error: Error): void {
    this.emit("source:error", sourceId, sourceName, error);
  }

  onArticleNew(
    handler: (
      article: ParsedArticle,
      sourceId: string,
      sourceName: string
    ) => void
  ): void {
    this.on("article:new", handler);
  }

  onArticleSaved(
    handler: (
      article: ParsedArticle & { id: string },
      sourceId: string,
      sourceName: string
    ) => void
  ): void {
    this.on("article:saved", handler);
  }

  onSourceConnected(
    handler: (sourceId: string, sourceName: string) => void
  ): void {
    this.on("source:connected", handler);
  }

  onSourceDisconnected(
    handler: (sourceId: string, sourceName: string) => void
  ): void {
    this.on("source:disconnected", handler);
  }

  onSourceError(
    handler: (sourceId: string, sourceName: string, error: Error) => void
  ): void {
    this.on("source:error", handler);
  }
}

export const newsEventEmitter = new NewsEventEmitter();
