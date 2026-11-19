"""Centralized Camera Configuration & Safe RTSP URL Construction.

Supports CP PLUS IP cameras with robust URL construction, special-character
password escaping, credential sanitization for logs, and environment variable
loading via python-dotenv.
"""

from __future__ import annotations

import os
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv

# Base Directory Resolution
CAMERA_MODULE_DIR = Path(__file__).resolve().parent
AI_SERVICES_DIR = CAMERA_MODULE_DIR.parent.parent

# Load .env file from ai-services root
_env_path = AI_SERVICES_DIR / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
else:
    load_dotenv(override=True)


def sanitize_rtsp_url(url: str | int) -> str:
    """Masks credentials in RTSP URLs to prevent sensitive password exposure in logs.

    Examples:
        'rtsp://camera-user:example-password@camera-1.example:554/cam/realmonitor?channel=1&subtype=1'
        -> 'rtsp://camera-user:***@camera-1.example:554/cam/realmonitor?channel=1&subtype=1'

        'rtsp://camera-user:example-password@camera-2.example:554/stream'
        -> 'rtsp://camera-user:***@camera-2.example:554/stream'

    Args:
        url: RTSP URL string or camera index.

    Returns:
        Sanitized string safe for logging and console output.
    """
    if not isinstance(url, str):
        return str(url)

    # Match rtsp(s)://user:password@host...
    pattern = r"^(rtsp[s]?://)([^:@]+)(?::([^@]+))?@(.+)$"
    match = re.match(pattern, url, re.IGNORECASE)
    if match:
        scheme, user, password, rest = match.groups()
        if password is not None:
            return f"{scheme}{user}:***@{rest}"
        return f"{scheme}{user}@{rest}"

    return url


@dataclass
class CameraConfig:
    """Configuration specification for an IP or USB camera."""

    camera_id: str             # e.g., "CAM-01", "CAM-02"
    name: str                  # Human-readable camera name.
    ip: str                    # Camera IP from local environment configuration.
    port: int = 554            # Default RTSP port: 554
    username: str = ""
    password: str = ""
    channel: int = 1           # Channel 1
    subtype: int = 0           # 0 = Main-stream (high-resolution), 1 = Sub-stream
    scheme: str = "rtsps"      # "rtsps" (SSL/TLS encrypted, default on CP PLUS) or "rtsp"
    custom_path: Optional[str] = None
    transport: str = "tcp"     # "tcp" or "udp"
    connect_timeout_sec: float = 5.0
    read_timeout_sec: float = 3.0
    reconnect_enabled: bool = True
    reconnect_initial_delay: float = 1.0
    reconnect_backoff_factor: float = 2.0
    reconnect_max_delay: float = 30.0

    def get_rtsp_path(self) -> str:
        """Generates the RTSP resource path for the CP PLUS stream."""
        if self.custom_path:
            return self.custom_path if self.custom_path.startswith("/") else f"/{self.custom_path}"
        # Native CP PLUS ONVIF live stream path
        return f"/video/live?channel={self.channel}&subtype={self.subtype}&unicast=true&proto=Onvif"

    def get_rtsp_url(
        self,
        sanitize: bool = False,
        encode_credentials: bool = True,
        override_scheme: Optional[str] = None,
        override_path: Optional[str] = None,
    ) -> str:
        """Constructs the full RTSP / RTSPS URL.

        Handles special characters (e.g. '@', ':', '/') in username and password
        via URL percent-encoding to ensure compatibility with FFmpeg/OpenCV parsers.

        Args:
            sanitize: If True, masks the password with '***' for safe logging.
            encode_credentials: If True, URL-encodes special characters in credentials.
            override_scheme: Optional scheme override ('rtsps' or 'rtsp').
            override_path: Optional path override.

        Returns:
            The complete RTSP/RTSPS URL string.
        """
        user = self.username
        pwd = self.password
        scheme = override_scheme or self.scheme or "rtsps"

        if sanitize:
            pwd_str = "***"
            user_str = user
        else:
            if encode_credentials:
                user_str = urllib.parse.quote(user, safe="")
                pwd_str = urllib.parse.quote(pwd, safe="")
            else:
                user_str = user
                pwd_str = pwd

        path = override_path or self.get_rtsp_path()
        if user_str and pwd_str:
            return f"{scheme}://{user_str}:{pwd_str}@{self.ip}:{self.port}{path}"
        elif user_str:
            return f"{scheme}://{user_str}@{self.ip}:{self.port}{path}"
        else:
            return f"{scheme}://{self.ip}:{self.port}{path}"

    @property
    def sanitized_url(self) -> str:
        """Safe URL representation for logging."""
        return self.get_rtsp_url(sanitize=True)


def load_camera_config_from_env(camera_num: int) -> Optional[CameraConfig]:
    """Loads a specific camera configuration from environment variables.

    Args:
        camera_num: Camera index number (1 or 2).

    Returns:
        CameraConfig instance if IP is defined, otherwise None.
    """
    prefix = f"CAMERA_{camera_num}_"
    ip = os.environ.get(f"{prefix}IP", "").strip()
    if not ip:
        return None

    camera_id = f"CAM-0{camera_num}"
    name = f"CP PLUS Camera {camera_num} ({ip})"
    username = os.environ.get(f"{prefix}USERNAME", "").strip()
    password = os.environ.get(f"{prefix}PASSWORD", "").strip()
    port = int(os.environ.get(f"{prefix}RTSP_PORT", "554"))
    subtype = int(os.environ.get(f"{prefix}STREAM_SUBTYPE", "0"))
    channel = int(os.environ.get(f"{prefix}CHANNEL", "1"))
    scheme = os.environ.get(f"{prefix}SCHEME") or os.environ.get("CAMERA_SCHEME", "rtsps").strip().lower()
    custom_path = os.environ.get(f"{prefix}RTSP_PATH", None)

    transport = os.environ.get("CAMERA_RTSP_TRANSPORT", "tcp").strip().lower()
    connect_timeout = float(os.environ.get("CAMERA_CONNECT_TIMEOUT_SEC", "5.0"))
    read_timeout = float(os.environ.get("CAMERA_READ_TIMEOUT_SEC", "3.0"))
    reconnect_enabled = os.environ.get("CAMERA_RECONNECT_ENABLED", "true").lower() == "true"
    reconnect_initial = float(os.environ.get("CAMERA_RECONNECT_INITIAL_DELAY_SEC", "1.0"))
    reconnect_backoff = float(os.environ.get("CAMERA_RECONNECT_BACKOFF_FACTOR", "2.0"))
    reconnect_max = float(os.environ.get("CAMERA_RECONNECT_MAX_DELAY_SEC", "30.0"))

    return CameraConfig(
        camera_id=camera_id,
        name=name,
        ip=ip,
        port=port,
        username=username,
        password=password,
        channel=channel,
        subtype=subtype,
        scheme=scheme,
        custom_path=custom_path,
        transport=transport,
        connect_timeout_sec=connect_timeout,
        read_timeout_sec=read_timeout,
        reconnect_enabled=reconnect_enabled,
        reconnect_initial_delay=reconnect_initial,
        reconnect_backoff_factor=reconnect_backoff,
        reconnect_max_delay=reconnect_max,
    )


def get_available_camera_configs() -> Dict[str, CameraConfig]:
    """Scans environment and returns all configured cameras keyed by camera_id."""
    cameras: Dict[str, CameraConfig] = {}
    for num in (1, 2):
        cfg = load_camera_config_from_env(num)
        if cfg:
            cameras[cfg.camera_id] = cfg
    return cameras


def get_camera_config(camera_id_or_num: str | int) -> CameraConfig:
    """Resolves a CameraConfig by camera ID (e.g. 'CAM-01', '1', 'CAM-02', '2').

    Raises:
        ValueError: If the requested camera is not configured in .env.
    """
    key = str(camera_id_or_num).strip().upper()
    if key in ("1", "CAM-1", "CAM01"):
        key = "CAM-01"
    elif key in ("2", "CAM-2", "CAM02"):
        key = "CAM-02"

    configs = get_available_camera_configs()
    if key in configs:
        return configs[key]

    raise ValueError(
        f"Camera '{camera_id_or_num}' is not configured in environment.\n"
        f"Available cameras: {list(configs.keys())}\n"
        f"Please verify CAMERA_1_IP or CAMERA_2_IP in .env."
    )
