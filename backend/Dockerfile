# Stage 1: Build the .NET application
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy only the project file to restore dependencies first
COPY backend/src/LabSOM.Backend.Core/LabSOM.Backend.Core.csproj backend/src/LabSOM.Backend.Core/
RUN dotnet restore backend/src/LabSOM.Backend.Core/LabSOM.Backend.Core.csproj

# Copy the rest of the backend source code
COPY backend/ backend/
RUN dotnet publish backend/src/LabSOM.Backend.Core/LabSOM.Backend.Core.csproj -c Release -o /app/publish /p:UseAppHost=false

# Stage 2: Final Runtime Image (CUDA + Python + .NET 8)
FROM nvidia/cuda:13.2.1-runtime-ubuntu22.04

# Avoid tzdata interactive prompt during apt-get install
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies: Python, pip, and .NET 8 Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python-is-python3 \
    wget \
    ca-certificates \
    software-properties-common \
    && wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && rm packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends aspnetcore-runtime-8.0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the Python engine scripts and requirements
COPY engine/ /app/engine/

# Upgrade pip, setuptools, and wheel to get the fast, modern dependency resolver
RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel

# Install python dependencies
RUN pip3 install --no-cache-dir -r /app/engine/requirements.txt

# Copy the published .NET application from the build stage
COPY --from=build /app/publish /app/backend

# Configure ASP.NET Core to listen on port 5123
ENV ASPNETCORE_URLS=http://+:5123

EXPOSE 5123

WORKDIR /app/backend
ENTRYPOINT ["dotnet", "LabSOM.Backend.Core.dll"]
