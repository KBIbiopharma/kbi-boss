# Demo datasets

Public datasets for showing KBI BOSS. Drag a file onto the tool, or choose it with "Choose a CSV file". These are files on disk; the page never downloads them on its own.

| File | Rows | Use it to show | Pick as target | Source and licence |
|---|---|---|---|---|
| `concrete-strength.csv` | 1,030 | A process recipe: which ingredients drive strength | `strength`, higher is better | I-Cheng Yeh, *Concrete Compressive Strength*, UCI Machine Learning Repository. CC BY 4.0. |
| `wine-quality-white.csv` | 4,898 | Quality from lab measurements, and an honest "weak model" verdict | `quality`, higher is better | P. Cortez et al. (2009), *Wine Quality*, UCI Machine Learning Repository. CC BY 4.0. |
| `bioreactor-process-log.csv` + `densitometer-qc-report.csv` | 64 + 124 | Joining two files on BatchID, column roles, one-sided purity spec (LSL 95), and multi-result optimization (purity, titer, HMW, LMW) | `Purity_Pct`, higher is better | Synthetic, made for this tool. Free to use. |
| `penguins.csv` | 344 | Classification with missing values, and unsupervised grouping | `species`, or "Nothing" for groups | Horst, Hill and Gorman, *palmerpenguins*. CC0. |

The built-in practice datasets (molding yield, 2⁴ factorial DOE, batch pass/fail, loyalty tiers, bioreactor + QC, customer segments) are synthetic and need no file.
