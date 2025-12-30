import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * API Error class with status code and optional error code
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Parse error response from API
 */
async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    return new ApiError(
      response.status,
      data.error ?? "Request failed",
      data.code
    );
  } catch {
    return new ApiError(
      response.status,
      response.statusText ?? "Request failed"
    );
  }
}

/**
 * Centralized API client with error handling
 */
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an API request with proper error handling
   */
  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    return response.json();
  }

  /**
   * GET request
   */
  async get<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    let url = endpoint;

    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const query = searchParams.toString();
      if (query) {
        url = `${endpoint}?${query}`;
      }
    }

    return this.request<T>(url);
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: "DELETE",
    });
  }
}

/**
 * Singleton API client instance
 */
export const api = new ApiClient(API_URL);

/**
 * Global error handler for mutations
 * Shows toast notification for common errors
 */
export function handleMutationError(error: unknown): void {
  if (error instanceof ApiError) {
    switch (error.statusCode) {
      case 401:
        toast.error("Please log in to continue");
        break;
      case 403:
        toast.error("You don't have permission to do this");
        break;
      case 404:
        toast.error("Resource not found");
        break;
      case 422:
        toast.error(error.message);
        break;
      default:
        toast.error(error.message ?? "Something went wrong");
    }
  } else if (error instanceof Error) {
    toast.error(error.message);
  } else {
    toast.error("An unexpected error occurred");
  }
}

/**
 * Create QueryClient with default error handling
 */
export function createQueryClientConfig() {
  return {
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount: number, error: unknown) => {
          // Don't retry on auth errors
          if (error instanceof ApiError && error.statusCode === 401) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        onError: handleMutationError,
      },
    },
  };
}
