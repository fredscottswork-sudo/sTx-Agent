"""Built-in tools for the STX Agent runtime."""

from ..config import IndexSettings, MemorySettings, NetworkSettings
from .base import Tool, ToolContext, ToolResult
from .filesystem import built_in_filesystem_tools
from .git_tools import built_in_git_tools
from .intelligence import built_in_intelligence_tools
from .registry import ToolRegistry
from .terminal import TerminalTool
from .web import WebFetchTool


def build_default_registry(
    index_settings: IndexSettings | None = None,
    memory_settings: MemorySettings | None = None,
    network_settings: NetworkSettings | None = None,
    *,
    include_index: bool = True,
    include_memory: bool = True,
    include_network: bool = False,
) -> ToolRegistry:
    index_settings = index_settings or IndexSettings()
    memory_settings = memory_settings or MemorySettings()
    network_settings = network_settings or NetworkSettings()
    tools = built_in_filesystem_tools() + built_in_git_tools() + [TerminalTool()]
    if include_network:
        tools.append(WebFetchTool(network_settings))
    intelligence = built_in_intelligence_tools(index_settings, memory_settings)
    if not include_index:
        intelligence = [tool for tool in intelligence if not tool.name.startswith("project.")]
    if not include_memory:
        intelligence = [tool for tool in intelligence if not tool.name.startswith("memory.")]
    return ToolRegistry(tools + intelligence)


__all__ = ["Tool", "ToolContext", "ToolResult", "ToolRegistry", "build_default_registry"]
