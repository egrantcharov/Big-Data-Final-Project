import org.apache.spark.sql.SparkSession
import org.apache.spark.sql.functions._
import org.apache.spark.sql.types._

// 1. SparkSession with Hive
val spark = SparkSession.builder()
  .appName("TaxiFileStreamingJob")
  .enableHiveSupport()
  .getOrCreate()

import spark.implicits._

// Use your project DB
spark.sql("USE taxi_project")

// 2. Schema (same as taxi_raw)
val schema = new StructType()
  .add("vendor_id", StringType)
  .add("tpep_pickup_datetime", TimestampType)
  .add("tpep_dropoff_datetime", TimestampType)
  .add("passenger_count", IntegerType)
  .add("trip_distance", DoubleType)
  .add("pu_location_id", IntegerType)
  .add("do_location_id", IntegerType)
  .add("fare_amount", DoubleType)
  .add("tip_amount", DoubleType)
  .add("total_amount", DoubleType)

// 3. Streaming source: new CSV files in HDFS directory
val rides = spark.readStream
  .schema(schema)
  .option("header", "false")  // taxi_raw.csv has header, but we removed it in sample (head kept it; we'll ignore first line)
  .csv("/user/hadoop/taxi_project/stream_input")
  .withWatermark("tpep_pickup_datetime", "30 minutes")

// 4. Live stats over 10-minute windows
val liveStats = rides
  .groupBy(window(col("tpep_pickup_datetime"), "10 minutes"))
  .agg(
    count("*").as("trip_count"),
    avg("fare_amount").as("avg_fare"),
    avg("trip_distance").as("avg_distance")
  )

// 5. Write streaming output to Parquet in HDFS
val query = liveStats.writeStream
  .outputMode("append")
  .format("parquet")
  .option("path", "/user/hadoop/taxi_project/live_stats")
  .option("checkpointLocation", "/user/hadoop/taxi_project/checkpoints/live_stats")
  .start()

query.awaitTermination()