# Taxi Live Statistics — Final Project (Big Data / Lambda Architecture)

This project implements a complete **Lambda Architecture pipeline** (Batch Layer + Speed Layer + Serving Layer) to 
generate a **Taxi Live Statistics Dashboard**.  
It mirrors the high‑level structure of the class’s flight/weather example but is **fully redesigned** around 
New York City taxi data.

The system ingests raw taxi trips, performs both batch and streaming aggregation using Spark, exports aggregated 
results to HDFS/CSV, and serves the final dataset from a Node.js + Express web server deployed on an EC2 instance. 
The frontend (`taxi.html`) visualizes 50k+ processed trips and highlights temporal traffic patterns.

This README gives:

1. A fully explicit architectural explanation  
2. A description of every file in the repository  
3. A detailed account of how the project was executed on the cluster  
4. All commands used to run the application, including Spark Streaming jobs  
5. Notes on stopping streaming jobs  
6. Demo instructions / what to leave running for submission  

---

# 1. Project Overview

The goal of the project was to build a **scalable, distributed analytics pipeline** that computes taxi traffic 
statistics over time and presents them through a simple, interactive dashboard.

The design follows the Lambda Architecture:

- **Batch Layer:** processes the full ~2GB historical NYC taxi dataset using Spark, producing clean aggregates and 
- baseline statistics.
- **Speed Layer:** Spark Streaming job processes *live or simulated* incoming taxi events, computing 10‑minute 
- rolling-window aggregates.
- **Serving Layer:** Node.js + Express server loads aggregated CSVs (exported from the streaming pipeline) and 
- serves them to the frontend dashboard.

The final UI computes:
- Total observed trips  
- Busiest hour-of-day  
- Weekday vs weekend traffic  
- Day vs night distribution  
- Top 5 busiest 10-minute windows  
- Hour‑of‑day and day‑of‑week charts (Chart.js)  
- Samples of streaming windows  

---

# 2. Repository Structure (Fully Explained File‑by‑File)

## **app.js**
- Node.js Express server forming the **Serving Layer**.
- Hosts static files from `public/`.
- Defines API endpoint:
  - `GET /api/taxi/live_stats` → loads `data/taxi_live_stats.csv`, parses it, returns JSON.
- Includes HBase client setup (from class template); unused in this project since exported CSVs are served instead.
- Started using:
  ```
  node app.js 3012 http://ec2-44-201-161-20.compute-1.amazonaws.com:8070/
  ```

## **public/taxi.html**
Main dashboard UI.  
Fetches `/api/taxi/live_stats` and computes:

- Total trips  
- Busiest hour-of-day  
- Day vs night traffic  
- Weekday vs weekend traffic  
- Top 5 busiest windows  

Renders:
- **Key Insights** (bulleted, bold)
- **Chart.js bar charts** (hour of day and day of week)
- **Top 5 windows table**
- **Sample of 10‑minute windows table**

This is the only frontend page relevant for the final project.

## **data/taxi_live_stats.csv**
- Exported snapshot produced by the Spark Streaming job.
- Represents 10‑minute aggregated windows of taxi trip events.
- Fields:
  - `window_start`
  - `window_end`
  - `count` (trips)
  - `metric1`, `metric2` (placeholders for additional features)

## **spark/**  
Cluster-side code (Scala) that implements the Batch + Speed layers.

### Spark Batch Job
- Loads full historical taxi data (~2GB) from HDFS.  
- Cleans, filters, and computes:
  - Trips per hour  
  - Trips per day of week  
  - Weekday vs weekend  
  - Day vs night  
- Writes results to HDFS for analysis or export.

### Spark Streaming Job (Speed Layer)
- Reads streaming taxi events (Kafka or HDFS‑appended file stream).
- Applies Structured Streaming windowing:
  ```
  groupBy(window($"timestamp", "10 minutes"))
  ```
- Maintains state via checkpointing.
- Writes aggregated windows to:
  - HBase (when the old cluster was functional)
  - Export directories (`live_stats_export/`) for final integration into the dashboard.

## **package.json / package-lock.json**
Node dependencies for:
- Express server  
- CSV parsing  
- HBase client (unused)  

## **node_modules/**
Auto-generated dependency directory; not manually edited.

---

# 3. Detailed Lambda Architecture Explanation

## **Batch Layer**
- Source dataset: NYC Yellow Taxi, ~2GB CSV.
- Uploaded to HDFS:
  ```
  hdfs dfs -put taxi_raw.csv /user/hadoop/taxi_project/raw/
  ```
- Spark batch scripts compute heavy aggregates and save them to:
  ```
  /user/hadoop/taxi_project/batch_output/
  ```
- Outputs include:
  - trips_by_hour.csv  
  - trips_by_day_of_week.csv  
  - weekday_vs_weekend.csv  
  - day_vs_night.csv  

These serve as static reference views for the dashboard.

---

## **Speed Layer**
A Spark Structured Streaming job continuously processes incoming taxi events.

### Features:
- Reads from Kafka or “simulated live” HDFS stream.
- Uses a 10‑minute tumbling window:
  ```
  withWatermark("timestamp", "20 minutes")
  .groupBy(window(col("timestamp"), "10 minutes"))
  ```
- State stored in:
  ```
  /user/hadoop/taxi_project/checkpoints/
  ```
- Final rolling aggregates exported to:
  ```
  /user/hadoop/live_stats_export/
  ```

These exported files are merged into `taxi_live_stats.csv`, which the Node server uses.

Due to cluster version issues (like we have discussed), HBase became unstable recently.
However, the **speed layer was implemented, run, and exported successfully**, and the exported CSV is used for serving.

---

## **Serving Layer**
Implemented entirely in Node.js + Express on a separate EC2 host:

- Loads `data/taxi_live_stats.csv`
- Serves `/api/taxi/live_stats`
- Frontend fetches the JSON and renders charts + insights

For avoidance of doubt: **at demo time, the web application does not query HBase live.** Instead, it reads from 
`data/taxi_live_stats.csv`, which is a static export of the windowed 
aggregates produced by the Spark Structured Streaming speed layer (written first to `/user/
hadoop/taxi_project/live_stats_export/` on HDFS and then merged into a single CSV and copied to 
the web server). This keeps the demo robust against cluster/HBase instability while still
demonstrating a complete Lambda pipeline from raw data → batch/streaming computation → exported 
view → serving layer.

To start the web server:
```
ssh -i ~/.ssh/id_rsa ec2-user@ec2-52-20-203-80.compute-1.amazonaws.com
cd egrantcharov/
node app.js 3012 http://ec2-44-201-161-20.compute-1.amazonaws.com:8070/
```

---

# 4. Commands Used Throughout the Project

## HDFS Ingestion
```
hdfs dfs -put taxi_raw.csv /user/hadoop/taxi_project/raw/
```

## Running Spark Batch Jobs
```
spark-submit \
  --class TaxiBatchJob \
  --master yarn \
  batch-job.jar \
  --input /user/hadoop/taxi_project/raw/ \
  --output /user/hadoop/taxi_project/batch_output/
```

## Running Spark Streaming (Speed Layer)
```
spark-submit \
  --class TaxiStreamingJob \
  --master yarn \
  --deploy-mode client \
  taxi-streaming.jar \
  --output /user/hadoop/live_stats_export/
```

## Stopping Spark Streaming Jobs
List applications:
```
yarn application -list
```
Kill specific streaming jobs:
```
yarn application -kill <app_id>
```

**For submission:**  
Stop **all** streaming jobs associated with your user:
```
yarn application -list | grep egrantcharov
```
Then kill each one:
```
yarn application -kill <id>
```

### Verification: No Active Spark / Streaming Jobs (Actual Cluster Output)

For the final submission, I verified that **no Spark or streaming jobs are currently running** on the cluster by 
issuing the following commands from the Hadoop master node:

```bash
yarn application -list
```

Output:

```text
WARNING: YARN_CONF_DIR has been replaced by HADOOP_CONF_DIR. Using value of YARN_CONF_DIR.
2025-12-10 04:00:20,107 INFO client.DefaultNoHARMFailoverProxyProvider: Connecting to ResourceManager at ip-172-31-91-77.ec2.internal/172.31.91.77:8032
2025-12-10 04:00:20,190 INFO client.AHSProxy: Connecting to Application History server at ip-172-31-91-77.ec2.internal/172.31.91.77:10200
Total number of applications (application-types: [], states: [SUBMITTED, ACCEPTED, RUNNING] and tags: []):0
                Application-Id      Application-Name        Application-Type          User           Queue                   State             Final-State             Progress                          Tracking-URL     Tags
```

I also double-checked specifically for Spark / Streaming / user-specific jobs:

```bash
yarn application -list | grep -i spark
yarn application -list | grep -i streaming
yarn application -list | grep egrantcharov
```

Each of these returned **no matches**, confirming that:
- There are **0 SUBMITTED / ACCEPTED / RUNNING** YARN applications.
- There are **no active Spark or streaming jobs** for this project.
```

---

# 5. Deployment Workflow (Frontend + API)

## Upload Updated Frontend Files
```
scp -i ~/.ssh/id_rsa public/taxi.html \
  ec2-user@ec2-52-20-203-80.compute-1.amazonaws.com:/home/ec2-user/egrantcharov/public/taxi.html
```

## Verify Deployment
Go to:
```
http://ec2-52-20-203-80.compute-1.amazonaws.com:3012/taxi.html
```

---

# 6. Conclusion

This project has:

- Ability to manage datasets at MINIMUM ~2GB scale  
- Spark batch processing + Structured Streaming  
- Windowed streaming aggregation  
- Handling of exported streaming outputs  
- Deployment of a Serving Layer on EC2  
- Full Lambda Architecture integration  

Despite recent cluster instability, the full pipeline was implemented, executed, exported, and presented 
in a cohesive end‑to‑end system. The final demo uses the exported snapshot (`data/taxi_live_stats.csv`) as a 
materialized view of the speed layer output, which allows us to periodically publish aggregates from streaming or 
batch computations.