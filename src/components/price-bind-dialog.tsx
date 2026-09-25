import { useQuery } from "@tanstack/react-query";
import { Check, RotateCcw, Sparkles, Tag, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatUnitPrice } from "@/lib/format";
import {
  fetchLiteLLMPrices,
  removeCustomPrice,
  removeModelMapping,
  resetMatcherCache,
  type SimilarModelCandidate,
  saveCustomPrice,
  saveModelMapping,
} from "@/lib/prices";
import type { ModelPrice } from "@/lib/types";

export function PriceBindDialog({
  model,
  currentPrice,
  currentSource,
  onClose,
  onSaved,
}: {
  model: string;
  currentPrice: ModelPrice["price"];
  currentSource?: "custom" | "mapped" | "auto";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"suggest" | "manual">("suggest");
  const [inputCost, setInputCost] = useState(currentPrice ? String(currentPrice.input) : "");
  const [outputCost, setOutputCost] = useState(currentPrice ? String(currentPrice.output) : "");
  const [cacheReadCost, setCacheReadCost] = useState(
    currentPrice?.cacheRead !== null && currentPrice?.cacheRead !== undefined ? String(currentPrice.cacheRead) : "",
  );
  const [cacheCreationCost, setCacheCreationCost] = useState(
    currentPrice?.cacheCreation !== null && currentPrice?.cacheCreation !== undefined
      ? String(currentPrice.cacheCreation)
      : "",
  );
  const [providerTag, setProviderTag] = useState(currentPrice?.provider || "custom");

  const similarQuery = useQuery({
    queryKey: ["similar-models", model],
    queryFn: async () => {
      const matcher = await fetchLiteLLMPrices();
      return matcher.findSimilar(model, 3);
    },
    staleTime: 60_000,
  });

  const bindModel = (targetModel: string) => {
    saveModelMapping(model, targetModel);
    removeCustomPrice(model);
    resetMatcherCache();
    toast.success(`已将「${model}」绑定至「${targetModel}」的价格`);
    onSaved();
    onClose();
  };

  const handleManualSave = (e: React.FormEvent) => {
    e.preventDefault();
    const input = Number(inputCost);
    const output = Number(outputCost);
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      toast.error("请输入有效的输入与输出单价数值");
      return;
    }

    saveCustomPrice(model, {
      model,
      provider: providerTag.trim() || "custom",
      input,
      output,
      cacheRead: cacheReadCost.trim() !== "" ? Number(cacheReadCost) : null,
      cacheCreation: cacheCreationCost.trim() !== "" ? Number(cacheCreationCost) : null,
    });
    removeModelMapping(model);
    resetMatcherCache();
    toast.success(`已保存「${model}」的自定义单价`);
    onSaved();
    onClose();
  };

  const handleReset = () => {
    removeCustomPrice(model);
    removeModelMapping(model);
    resetMatcherCache();
    toast.success(`已清除「${model}」的自定义价格，恢复系统自动匹配`);
    onSaved();
    onClose();
  };

  const isCustomized = currentSource === "custom" || currentSource === "mapped";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Tag className="size-4 text-primary" />
            <DialogTitle className="truncate font-mono text-base">单价配置：{model}</DialogTitle>
          </div>
        </DialogHeader>

        {isCustomized && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
            <span className="text-muted-foreground">
              当前状态：
              <Badge variant="secondary" className="ml-1 text-[11px]">
                {currentSource === "custom" ? "手动自定义单价" : `已绑定至 ${currentPrice?.matched}`}
              </Badge>
            </span>
            <Button size="xs" variant="ghost" onClick={handleReset} className="h-6 gap-1 text-muted-foreground">
              <RotateCcw className="size-3" />
              恢复自动匹配
            </Button>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => v && setTab(v as "suggest" | "manual")}>
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="suggest" className="flex-1 gap-1.5">
              <Sparkles className="size-3.5" />
              智能推荐匹配
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 gap-1.5">
              <Wand2 className="size-3.5" />
              手动输入单价
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggest" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              通过字符串相似度算法，从 LiteLLM 价格表中推荐最相似的模型。点击即可一键绑定此价格：
            </p>

            {similarQuery.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : !similarQuery.data?.length ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                未找到相似度较高的参考模型，请切换至「手动输入单价」。
              </div>
            ) : (
              <div className="space-y-2">
                {similarQuery.data.map((c: SimilarModelCandidate) => {
                  const isCurrentBound = currentPrice?.matched.toLowerCase() === c.model.toLowerCase();
                  return (
                    <Card key={c.model} className="transition-colors hover:border-primary/40">
                      <CardContent className="flex items-center justify-between p-3 gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold truncate" title={c.model}>
                              {c.model}
                            </span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              {c.score}% 相似度
                            </Badge>
                            {c.provider && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                                {c.provider}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                            <span>入: {formatUnitPrice(c.price.input)}/M</span>
                            <span>出: {formatUnitPrice(c.price.output)}/M</span>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant={isCurrentBound ? "secondary" : "outline"}
                          disabled={isCurrentBound}
                          onClick={() => bindModel(c.model)}
                          className="shrink-0 h-7 text-xs"
                        >
                          {isCurrentBound ? <Check className="size-3 mr-1 text-primary" /> : null}
                          {isCurrentBound ? "当前绑定" : "以此价格绑定"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="pt-3">
            <form onSubmit={handleManualSave} className="space-y-3.5">
              <p className="text-xs text-muted-foreground">直接输入该模型适用的单价（单位：美元 / 百万 tokens）：</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="manual-input" className="text-xs">
                    输入单价 ($ / 1M tokens) *
                  </Label>
                  <Input
                    id="manual-input"
                    type="number"
                    step="any"
                    min="0"
                    value={inputCost}
                    onChange={(e) => setInputCost(e.target.value)}
                    placeholder="例如 2.5"
                    className="mt-1 font-mono text-sm"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="manual-output" className="text-xs">
                    输出单价 ($ / 1M tokens) *
                  </Label>
                  <Input
                    id="manual-output"
                    type="number"
                    step="any"
                    min="0"
                    value={outputCost}
                    onChange={(e) => setOutputCost(e.target.value)}
                    placeholder="例如 10.0"
                    className="mt-1 font-mono text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="manual-cache-read" className="text-xs">
                    缓存读取单价 ($ / 1M tokens，选填)
                  </Label>
                  <Input
                    id="manual-cache-read"
                    type="number"
                    step="any"
                    min="0"
                    value={cacheReadCost}
                    onChange={(e) => setCacheReadCost(e.target.value)}
                    placeholder="例如 0.625"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-cache-create" className="text-xs">
                    缓存写入单价 ($ / 1M tokens，选填)
                  </Label>
                  <Input
                    id="manual-cache-create"
                    type="number"
                    step="any"
                    min="0"
                    value={cacheCreationCost}
                    onChange={(e) => setCacheCreationCost(e.target.value)}
                    placeholder="例如 3.125"
                    className="mt-1 font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="manual-provider" className="text-xs">
                  提供商标注（选填）
                </Label>
                <Input
                  id="manual-provider"
                  value={providerTag}
                  onChange={(e) => setProviderTag(e.target.value)}
                  placeholder="例如 custom、openai、anthropic"
                  className="mt-1 text-sm"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  取消
                </Button>
                <Button type="submit" size="sm">
                  保存自定义单价
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
