"""CargoFlow Python SDK: typed read access to the CargoFlow API, data frames and portfolio risk analytics.

>>> from cargoflow import CargoFlow
>>> from cargoflow import analytics as cfa
>>> cf = CargoFlow()
>>> pf = cf.portfolio()
>>> cfa.exposure(pf)
>>> cfa.simulate_default_recovery(pf, seed=1).summary()
"""

from . import analytics, gateway
from .analytics import Portfolio
from .client import DEFAULT_API_URL, CargoFlow, CargoFlowError, NotFoundError
from .frames import models_to_frame
from .gateway import sign_request
from .models import (
    AuditEntry,
    Cover,
    CoverOffer,
    Epoch,
    Facility,
    GatewaySource,
    MarketRequest,
    Milestone,
    ModelList,
    Party,
    Policy,
    Shipment,
    ShipmentCover,
    ShipmentView,
    Stats,
    TelemetrySummary,
    TrackPoint,
    usdg,
)

__version__ = "0.1.0"

__all__ = [
    "CargoFlow",
    "CargoFlowError",
    "NotFoundError",
    "DEFAULT_API_URL",
    "Portfolio",
    "analytics",
    "gateway",
    "sign_request",
    "models_to_frame",
    "usdg",
    "AuditEntry",
    "Cover",
    "CoverOffer",
    "Epoch",
    "Facility",
    "GatewaySource",
    "MarketRequest",
    "Milestone",
    "ModelList",
    "Party",
    "Policy",
    "Shipment",
    "ShipmentCover",
    "ShipmentView",
    "Stats",
    "TelemetrySummary",
    "TrackPoint",
    "__version__",
]
